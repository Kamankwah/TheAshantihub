"""Category visit counts and the "most visited categories" list (Plan M1).

A shopper opening a category sends one beacon (POST categories/<id>/visit/); it adds one to that category's count for
today in Africa/Accra. most_visited ranks the product departments by the visits of the last `days` days, counting a
sub-category's visits toward its department. Until the window holds MIN_VISITS_FOR_RANKING visits in total there is
too little to rank on, so the list is the seed order (Category.sort_order) and nothing is invented."""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone

from .models import Category, CategoryVisit

MIN_VISITS_FOR_RANKING = 50


def today():
    """Today's date in the project time zone (Africa/Accra)."""
    return timezone.localdate()


def record_visit(category):
    """Add one to `category`'s count for today. An atomic increment; the first visit of a day creates the row."""
    day = today()
    if CategoryVisit.objects.filter(category=category, day=day).update(count=F("count") + 1):
        return
    try:
        with transaction.atomic():
            CategoryVisit.objects.create(category=category, day=day, count=1)
    except IntegrityError:  # another request created the day's row first
        CategoryVisit.objects.filter(category=category, day=day).update(count=F("count") + 1)


def root_of(parents, category_id):
    """The top-level ancestor id of `category_id`, given {id: parent_id}."""
    seen = set()
    while parents.get(category_id) is not None and category_id not in seen:
        seen.add(category_id)
        category_id = parents[category_id]
    return category_id


def most_visited(limit=8, days=30):
    """Up to `limit` product departments, most visited first. Departments with no visits follow in seed order; with
    fewer than MIN_VISITS_FOR_RANKING visits in the window the whole list is the seed order."""
    return most_visited_ranking(limit=limit, days=days)[0]


def most_visited_ranking(limit=8, days=30):
    """(departments, ranked): the most_visited list, and whether it is really ranked by visits (False when it fell
    back to the seed order for want of data), so a page can say "most visited" only when that is true."""
    departments = list(
        Category.objects.filter(parent__isnull=True, kind=Category.PRODUCT).order_by("sort_order", "id")
    )
    parents = dict(Category.objects.values_list("id", "parent_id"))
    since = today() - timedelta(days=days - 1)
    totals = {}
    rows = (
        CategoryVisit.objects.filter(day__gte=since).values("category_id").annotate(total=Sum("count"))
    )
    for row in rows:
        root = root_of(parents, row["category_id"])
        totals[root] = totals.get(root, 0) + row["total"]
    ranked = {d.pk: totals.get(d.pk, 0) for d in departments}
    if sum(ranked.values()) < MIN_VISITS_FOR_RANKING:
        return departments[:limit], False
    visited = sorted((d for d in departments if ranked[d.pk] > 0), key=lambda d: (-ranked[d.pk], d.sort_order, d.pk))
    rest = [d for d in departments if ranked[d.pk] == 0]
    return (visited + rest)[:limit], True
