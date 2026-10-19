"""The category tree for the department menu (Plan M1).

Top-level nodes of every kind: product departments plus the service, stay and event categories, each with its `kind`
(and `is_accommodation`, so a stay can be labelled). The shopper view keeps only nodes that have at least one live
listing or event in the node or any descendant; a business creating a listing gets the full tree."""
from django.db.models import Q

from catalogue.offers import live_q
from cart.guard import deliverable_q

from .models import Category, Listing
from .visibility import hidden_business_q


def _populated_ids():
    """Ids of categories holding something a shopper can see now."""
    from events.views import _live_events_queryset  # the one rule for which events are public

    # Goods and food: published, priced, in stock (live_q). Services and stays have no price or stock rule: published
    # and from a business public browse shows.
    visible = live_q() | (Q(status=Listing.PUBLISHED) & ~deliverable_q() & ~hidden_business_q("business_owner__"))
    ids = set(Listing.objects.filter(visible).values_list("category_id", flat=True).distinct())
    ids |= set(_live_events_queryset().values_list("category_id", flat=True).distinct())
    return ids


def _node(category):
    return {
        "id": category.pk, "slug": category.slug, "label": category.label, "icon": category.icon,
        "color": category.color, "kind": category.kind, "is_accommodation": category.is_accommodation,
        "children": [],
    }


def shopper_ids(categories=None):
    """Ids of the categories a shopper sees: each populated category and all its ancestors."""
    if categories is None:
        categories = Category.objects.only("id", "parent_id")
    by_id = {c.pk: c for c in categories}
    keep = set()
    for category_id in _populated_ids():
        while category_id is not None and category_id not in keep and category_id in by_id:
            keep.add(category_id)
            category_id = by_id[category_id].parent_id
    return keep


def build_tree(full=False):
    categories = list(Category.objects.order_by("sort_order", "id"))
    keep = None if full else shopper_ids(categories)
    nodes = {c.pk: _node(c) for c in categories if keep is None or c.pk in keep}
    roots = []
    for category in categories:
        node = nodes.get(category.pk)
        if node is None:
            continue
        parent = nodes.get(category.parent_id)
        (parent["children"] if parent is not None else roots).append(node)
    return roots
