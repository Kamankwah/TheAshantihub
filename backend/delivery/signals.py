from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.models import StaffUser

from .models import Rider


@receiver(post_save, sender=StaffUser, dispatch_uid="delivery_make_rider_profile")
def make_rider_profile(sender, instance, **kwargs):
    """Every Dispatch account has one Rider profile (made at invite, or when the role is set)."""
    if instance.role_id and instance.role.name == "dispatch" and not Rider.objects.filter(staff_id=instance.pk).exists():
        Rider.objects.get_or_create(staff=instance)
