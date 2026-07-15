from datetime import timedelta

from django.db import migrations
from django.utils import timezone

# For every existing BusinessOwnerProfile (not just ones that already have a
# Subscription), this migration:
#
#   1. Infers `business_kind` ("product"/"service") from the owner's own
#      Listing rows' `category.kind` — whichever kind is most common among
#      their listings. An owner with no listings, or an exact tie between
#      product/service listing counts, defaults to "product" (ambiguous case
#      — "product" is the platform's lower-friction/cheaper baseline tier).
#      This mirrors listings/migrations/0009_backfill_category_kind.py's
#      "pick an explicit, documented default rather than leaving it unset"
#      approach.
#   2. Saves that inferred kind onto the profile.
#   3. Maps the inferred kind onto one of the 3 new SubscriptionPlan rows
#      seeded in 0012_seed_new_subscription_plans.py:
#        - "product" -> Product Unlimited if the owner already has MORE THAN
#          5 published listings (over the Product Basic cap), else Product
#          Basic (the default for the ambiguous/no-listings case too, per
#          0004_backfill_subscription_plan_entitlements.py's precedent of
#          preferring the cheaper/more conservative default when ambiguous).
#        - "service" -> Service.
#   4. update_or_create()s a Subscription row for the owner pointing at that
#      plan: is_trial=False, status="active", cycle_months=1, preserving
#      current_period_start if a Subscription already existed for them
#      (otherwise now()), with current_period_end recomputed as ~30 days
#      out. This is a simple, migration-local approximation — it does not
#      need to match whatever period-math helper a later task adds.
#
# This migration does NOT modify, unpublish, or otherwise touch any Listing
# row — it only reads Listing/Category to infer a kind.


def backfill(apps, schema_editor):
    BusinessOwnerProfile = apps.get_model("accounts", "BusinessOwnerProfile")
    Listing = apps.get_model("listings", "Listing")
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    Subscription = apps.get_model("billing", "Subscription")

    now = timezone.now()

    try:
        product_basic = SubscriptionPlan.objects.get(tier="product_basic")
        product_unlimited = SubscriptionPlan.objects.get(tier="product_unlimited")
        service_plan = SubscriptionPlan.objects.get(tier="service")
    except SubscriptionPlan.DoesNotExist:
        # Defensive — the seed migration this one depends on should always
        # have created these first, but don't hard-crash a data migration
        # over it.
        return

    for profile in BusinessOwnerProfile.objects.all():
        owner = profile.business_owner

        listings = Listing.objects.filter(business_owner=owner).select_related("category")
        product_count = listings.filter(category__kind="product").count()
        service_count = listings.filter(category__kind="service").count()

        if service_count > product_count:
            inferred_kind = "service"
        else:
            # No listings, a tie, or more product listings -> "product".
            inferred_kind = "product"

        profile.business_kind = inferred_kind
        profile.save(update_fields=["business_kind"])

        if inferred_kind == "service":
            plan = service_plan
        else:
            published_count = listings.filter(status="published").count()
            plan = product_unlimited if published_count > 5 else product_basic

        existing = Subscription.objects.filter(business_owner=owner).first()
        period_start = existing.current_period_start if existing else now
        period_end = now + timedelta(days=30)

        Subscription.objects.update_or_create(
            business_owner=owner,
            defaults={
                "plan": plan,
                "is_trial": False,
                "status": "active",
                "cycle_months": 1,
                "current_period_start": period_start,
                "current_period_end": period_end,
            },
        )


def unbackfill(apps, schema_editor):
    # No meaningful backwards operation — this migration only assigns
    # values that didn't exist before it ran (business_kind was always
    # null, and any Subscription it creates is a net-new row for owners who
    # didn't have one), so there's nothing well-defined to revert to.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0017_seed_subscription_plans_permissions"),
        ("listings", "0013_listing_service_duration_listing_specs"),
        ("billing", "0012_seed_new_subscription_plans"),
    ]
    operations = [migrations.RunPython(backfill, unbackfill)]
