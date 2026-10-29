from django.db.models.signals import post_delete
from django.dispatch import receiver

from .categories import resync_after_category_delete
from .models import BusinessOwnerCategory


@receiver(post_delete, sender=BusinessOwnerCategory, dispatch_uid="accounts_resync_categories_after_delete")
def keep_category_list_consistent(sender, instance, **kwargs):
    """Deleting a Category cascades its links away; close the gap and re-point the main category."""
    resync_after_category_delete([instance.profile_id])
