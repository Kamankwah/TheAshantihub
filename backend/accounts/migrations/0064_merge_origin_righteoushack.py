from django.db import migrations

# Integration merge of origin/righteoushack (business-hours and re-delivery-fee permissions, 0060/0061) with the
# marketplace M3 chain (General Manager role and staff-listing permissions, 0060-0063). Both chains stay as applied.


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0061_seed_redelivery_fee_permission"),
        ("accounts", "0063_general_manager_loses_delivery_promo_approve"),
    ]
    operations = []
