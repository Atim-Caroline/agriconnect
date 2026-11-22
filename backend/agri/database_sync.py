from django.apps import apps
from django.core.management import CommandError
from django.core.management.color import no_style
from django.db import connections, transaction

from .models import DatabaseSyncMap

SYNCED_APPS = {"agri", "auth", "contenttypes"}


def canonical_database(alias):
    return "local" if alias in ("default", "local") else alias


def sync_models(source, target, source_wins, prune=False, abort_if_mode=None):
    if source == target or canonical_database(source) == canonical_database(target):
        raise CommandError("Source and target must be different databases.")
    if source not in connections.databases or target not in connections.databases:
        raise CommandError("Both local and Supabase databases must be configured.")

    models = [
        model
        for model in apps.get_models()
        if model._meta.app_label in SYNCED_APPS
        and model is not DatabaseSyncMap
        and not model._meta.auto_created
    ]
    ordered_models = _order_models(models)
    with transaction.atomic(using=source):
        source_rows = {
            model: list(
                model._base_manager.using(source)
                .all()
                .order_by(model._meta.pk.name)
                .prefetch_related(*[field.name for field in model._meta.many_to_many])
            )
            for model in ordered_models
        }

    with transaction.atomic(using=target):
        return _sync_snapshot(
            source,
            target,
            source_wins,
            prune,
            abort_if_mode,
            ordered_models,
            source_rows,
        )


def _sync_snapshot(
    source,
    target,
    source_wins,
    prune,
    abort_if_mode,
    ordered_models,
    source_rows,
):
    source_identity = canonical_database(source)
    target_identity = canonical_database(target)
    maps = {}
    seen_target_pks = {}
    report = []
    changed_count = 0

    for model in ordered_models:
        if abort_if_mode and abort_if_mode():
            raise CommandError("Database mode changed during backup; sync was rolled back.")
        label = model._meta.label_lower
        maps[model] = {}
        seen_target_pks[model] = set()

        for source_object in source_rows[model]:
            source_pk = source_object.pk
            incoming = _mapped_values(source_object, model, maps, target)
            existing = _find_target(
                model,
                source_object,
                incoming,
                source,
                target,
                source_identity,
                target_identity,
            )

            if existing is None:
                primary_key = model._meta.pk
                auto_primary_key = primary_key.get_internal_type().endswith("AutoField")
                target_object = model(
                    **({"pk": None} if auto_primary_key else {"pk": source_pk}),
                    **incoming,
                )
                try:
                    target_object.save(using=target, force_insert=True)
                    _restore_automatic_fields(model, target_object, incoming, target)
                except Exception as exc:
                    raise CommandError(
                        f"Could not copy {label} record to '{target}': {type(exc).__name__}."
                    ) from exc
                should_copy_m2m = True
                changed_count += 1
            else:
                target_object = existing
                differences = [
                    field.name
                    for field in model._meta.concrete_fields
                    if not field.primary_key
                    and getattr(existing, field.attname) != incoming[field.attname]
                ]
                if differences:
                    report.append({
                        "model": label,
                        "source_pk": str(source_pk),
                        "target_pk": str(existing.pk),
                        "conflicting_fields": differences,
                        "resolution": "source_wins" if source_wins else "target_wins",
                    })
                    if source_wins:
                        for field in model._meta.concrete_fields:
                            if not field.primary_key:
                                setattr(target_object, field.attname, incoming[field.attname])
                        target_object.save(using=target)
                        _restore_automatic_fields(model, target_object, incoming, target)
                        changed_count += 1
                should_copy_m2m = source_wins

            target_pk = target_object.pk
            maps[model][source_pk] = target_pk
            seen_target_pks[model].add(target_pk)
            _save_mapping(
                target,
                source_identity,
                label,
                source_pk,
                target_pk,
            )

            if should_copy_m2m:
                _copy_many_to_many(
                    source_object,
                    target_object,
                    model,
                    maps,
                    source,
                )

    if prune:
        for model in reversed(ordered_models):
            keep_pks = seen_target_pks[model]
            stale = model._base_manager.using(target).exclude(
                pk__in=keep_pks
            )
            deleted, _ = stale.delete()
            changed_count += deleted

    if abort_if_mode and abort_if_mode():
        raise CommandError("Database mode changed during backup; sync was rolled back.")

    target_connection = connections[target]
    if target_connection.features.supports_sequence_reset:
        statements = target_connection.ops.sequence_reset_sql(
            no_style(),
            ordered_models,
        )
        with target_connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)

    return {
        "source": source_identity,
        "target": target_identity,
        "records_changed": changed_count,
        "conflicts": report,
    }


def _restore_automatic_fields(model, instance, values, target):
    automatic_values = {
        field.attname: values[field.attname]
        for field in model._meta.concrete_fields
        if (getattr(field, "auto_now", False) or getattr(field, "auto_now_add", False))
        and values[field.attname] is not None
    }
    if automatic_values:
        model._base_manager.using(target).filter(pk=instance.pk).update(**automatic_values)
        for field_name, value in automatic_values.items():
            setattr(instance, field_name, value)


def _order_models(models):
    model_set = set(models)
    ordered = []
    visiting = set()
    visited = set()

    def visit(model):
        if model in visited:
            return
        if model in visiting:
            raise CommandError(f"Database sync dependency cycle at {model._meta.label}.")
        visiting.add(model)
        for field in model._meta.concrete_fields:
            related_model = getattr(field, "related_model", None)
            if related_model in model_set and related_model is not model:
                visit(related_model)
        visiting.remove(model)
        visited.add(model)
        ordered.append(model)

    for model in models:
        visit(model)
    return ordered


def _mapped_values(source_object, model, maps, target):
    values = {}
    for field in model._meta.concrete_fields:
        if field.primary_key:
            continue
        value = getattr(source_object, field.attname)
        related_model = getattr(field, "related_model", None)
        if value is not None and related_model is not None:
            value = maps.get(related_model, {}).get(value, value)
            if not related_model._base_manager.using(target).filter(pk=value).exists():
                raise CommandError(
                    f"Missing related {related_model._meta.label} record while syncing "
                    f"{model._meta.label}."
                )
        values[field.attname] = value
    return values


def _find_target(
    model,
    source_object,
    incoming,
    source,
    target,
    source_identity,
    target_identity,
):
    label = model._meta.label_lower
    mapped = DatabaseSyncMap.objects.using(target).filter(
        source_database=source_identity,
        model_label=label,
        source_pk=str(source_object.pk),
    ).first()
    if mapped:
        existing = model._base_manager.using(target).filter(pk=mapped.target_pk).first()
        if existing:
            return existing

    reverse = DatabaseSyncMap.objects.using(source).filter(
        source_database=target_identity,
        model_label=label,
        target_pk=str(source_object.pk),
    ).first()
    if reverse:
        existing = model._base_manager.using(target).filter(pk=reverse.source_pk).first()
        if existing:
            return existing

    candidates = {}
    pk_field = model._meta.pk
    if not pk_field.get_internal_type().endswith("AutoField"):
        existing = model._base_manager.using(target).filter(pk=source_object.pk).first()
        if existing:
            candidates[existing.pk] = existing

    for group in _unique_groups(model):
        filters = {}
        valid = True
        for field_name in group:
            field = model._meta.get_field(field_name)
            value = incoming.get(field.attname) if not field.primary_key else source_object.pk
            if value is None:
                valid = False
                break
            filters[field.name] = value
        if valid:
            existing = model._base_manager.using(target).filter(**filters).first()
            if existing:
                candidates[existing.pk] = existing

    if len(candidates) > 1:
        raise CommandError(
            f"Conflicting unique keys identify multiple {label} records; "
            "review the databases before syncing."
        )
    return next(iter(candidates.values()), None)


def _unique_groups(model):
    groups = []
    for field in model._meta.fields:
        if field.unique and not field.primary_key:
            groups.append((field.name,))
    groups.extend(tuple(group) for group in model._meta.unique_together)
    for constraint in model._meta.constraints:
        if getattr(constraint, "fields", None):
            groups.append(tuple(constraint.fields))
    return groups


def _save_mapping(target, source_identity, label, source_pk, target_pk):
    DatabaseSyncMap.objects.using(target).update_or_create(
        source_database=source_identity,
        model_label=label,
        source_pk=str(source_pk),
        defaults={"target_pk": str(target_pk)},
    )


def _copy_many_to_many(source_object, target_object, model, maps, source):
    for field in model._meta.many_to_many:
        related_model = field.remote_field.model
        related_objects = source_object._prefetched_objects_cache.get(field.name)
        if related_objects is None:
            related_ids = getattr(source_object, field.name).using(source).values_list("pk", flat=True)
        else:
            related_ids = [obj.pk for obj in related_objects]
        target_ids = [
            maps.get(related_model, {}).get(pk, pk)
            for pk in related_ids
        ]
        getattr(target_object, field.name).set(target_ids)
