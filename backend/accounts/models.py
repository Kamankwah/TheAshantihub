from django.db import models

from .mixins import AuthenticatableAccountMixin


class Permission(models.Model):
    codename = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255)

    def __str__(self):
        return self.codename


class Role(models.Model):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    ACCOUNTANT = "accountant"
    MARKETING = "marketing"
    SUPPORT = "support"

    NAME_CHOICES = [
        (SUPER_ADMIN, "Super Admin"),
        (ADMIN, "Admin"),
        (ACCOUNTANT, "Accountant"),
        (MARKETING, "Marketing"),
        (SUPPORT, "Support"),
    ]

    name = models.CharField(max_length=20, choices=NAME_CHOICES, unique=True)
    permissions = models.ManyToManyField(Permission, related_name="roles", blank=True)

    def __str__(self):
        return self.name


class Customer(AuthenticatableAccountMixin, models.Model):
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, unique=True, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name
