"""Review finding BE-16: until a Super Admin saves a policy, money / approval / personal-data roles must use 2-step."""
from django.test import override_settings

from staffsecurity import policy

from .base import SecurityBase

DEFAULTS = ["accountant", "general_manager", "cosigner", "operations", "support"]


class DefaultTwoFactorRolesTests(SecurityBase):
    @override_settings(STAFF_TWO_FACTOR_DEFAULT_ROLES=DEFAULTS)
    def test_sensitive_roles_are_required_before_any_policy_is_saved(self):
        for role in DEFAULTS:
            self.assertTrue(policy.requires_two_factor(role), role)
        self.assertFalse(policy.requires_two_factor("scout"))
        self.assertFalse(policy.requires_two_factor("dispatch"))

    @override_settings(STAFF_TWO_FACTOR_DEFAULT_ROLES=DEFAULTS)
    def test_a_saved_policy_replaces_the_default_even_when_empty(self):
        policy.set_roles([], self.boss)
        self.assertFalse(policy.requires_two_factor("accountant"))
        policy.set_roles(["scout"], self.boss)
        self.assertTrue(policy.requires_two_factor("scout"))
        self.assertFalse(policy.requires_two_factor("support"))

    def test_the_test_environment_default_is_empty(self):
        self.assertFalse(policy.requires_two_factor("accountant"))
