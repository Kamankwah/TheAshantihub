from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wallets', '0006_vendor_text_more_kinds'),
    ]

    operations = [
        migrations.AlterField(
            model_name='vendortext',
            name='kind',
            field=models.CharField(choices=[('order_paid', 'Order paid'), ('order_released', 'Order released'), ('daily_digest', 'Daily digest'), ('refund', 'Refund'), ('withdrawal', 'Withdrawal'), ('balance_negative', 'Balance below zero'), ('balance_low', 'Balance low'), ('booking_paid', 'Booking paid'), ('booking_released', 'Booking released'), ('booking_on_hold', 'Booking on hold')], max_length=16),
        ),
    ]
