"""Review DB-07: money columns cannot hold a negative amount, whatever code path writes them."""
from django.db import IntegrityError, connection, transaction
from django.apps import apps
from django.db.migrations.state import ProjectState
from django.test import TestCase

from accounts.models import Customer
from core.migration_ops import AddCheckNotValid
from orders.models import Order

EXPECTED = 26  # Transaction.amount is deliberately unconstrained: refund records are negative


class MoneyChecksTests(TestCase):
    def test_every_constraint_exists_and_is_validated(self):
        with connection.cursor() as cursor:
            cursor.execute("select conname, convalidated from pg_constraint where conname like '%\\_gte0' and contype = 'c'")
            rows = cursor.fetchall()
        self.assertEqual(len(rows), EXPECTED, sorted(r[0] for r in rows))
        self.assertEqual([name for name, valid in rows if not valid], [])

    def test_a_negative_order_total_is_refused_by_the_database(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Order.objects.create(customer=customer, total_amount="-1.00")
        Order.objects.create(customer=customer, total_amount="0.00")  # zero is a legitimate total

    def test_a_missing_delivery_fee_is_still_allowed(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        self.assertIsNone(Order.objects.create(customer=customer, total_amount="5.00", delivery_fee=None).delivery_fee)

    def test_existing_bad_rows_leave_the_constraint_not_valid_instead_of_stopping_the_deploy(self):
        name = "orders_order_total_amount_gte0"
        constraint = next(c for c in Order._meta.constraints if c.name == name)
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        with connection.cursor() as cursor:
            cursor.execute(f"alter table orders_order drop constraint {name}")
        Order.objects.create(customer=customer, total_amount="-5.00")  # a legacy bad row
        with connection.cursor() as cursor:
            cursor.execute("set constraints all immediate")  # settle the insert's deferred FK check: ALTER TABLE refuses pending events
        state = ProjectState.from_apps(apps)
        with connection.schema_editor(atomic=False) as editor:
            AddCheckNotValid("order", constraint).database_forwards("orders", editor, state, state)
        with connection.cursor() as cursor:
            cursor.execute("select convalidated from pg_constraint where conname = %s", [name])
            self.assertEqual(cursor.fetchone(), (False,))
        with self.assertRaises(IntegrityError), transaction.atomic():  # still enforced for new rows
            Order.objects.create(customer=customer, total_amount="-1.00")


class MoneyRowsSurviveAnAccountDeleteTests(TestCase):
    """Review DB-08: a hard delete of a customer or business must not silently take their orders, payments, bookings or tickets
    with it. New foreign keys from money apps to an account must say PROTECT (or be listed here with a reason)."""

    MONEY_APPS = {"orders", "payments", "billing", "bookings", "services", "credit", "ledger", "wallets", "disputes", "commission"}
    ALLOWED_CASCADE = {
        "wallets.VendorText.business_owner",  # a queue of outgoing texts, not a financial record
    }

    def test_money_rows_protect_their_account(self):
        from django.db import models

        offenders = []
        for model in apps.get_models():
            if model._meta.app_label not in self.MONEY_APPS:
                continue
            for field in model._meta.get_fields():
                if not (field.is_relation and field.many_to_one and field.related_model._meta.label in {"accounts.Customer", "accounts.BusinessOwner"}):
                    continue
                label = f"{model._meta.label}.{field.name}"
                if field.remote_field.on_delete is models.CASCADE and label not in self.ALLOWED_CASCADE:
                    offenders.append(label)
        self.assertEqual(offenders, [], "use on_delete=PROTECT for money rows (review DB-08)")

    def test_an_account_with_an_order_cannot_be_hard_deleted(self):
        from django.db.models import ProtectedError

        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        Order.objects.create(customer=customer, total_amount="5.00")
        with self.assertRaises(ProtectedError), transaction.atomic():
            customer.delete()
        self.assertTrue(Order.objects.filter(customer=customer).exists())
