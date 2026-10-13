# Consent ledger and segments (Marketing M2). Hand-trimmed to this package's models.

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0047_seed_marketing_permissions'),
        ('marketing', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ConsentWording',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=40)),
                ('version', models.PositiveSmallIntegerField(default=1)),
                ('channel', models.CharField(choices=[('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('email', 'Email'), ('inapp', 'In-app')], max_length=10)),
                ('audience', models.CharField(choices=[('customer', 'Customers'), ('business_owner', 'Businesses')], max_length=20)),
                ('text', models.CharField(max_length=500)),
                ('live_from', models.DateTimeField(default=django.utils.timezone.now)),
                ('retired_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={
                'ordering': ['code', '-version'],
                'constraints': [models.UniqueConstraint(fields=('code', 'version'), name='mk_wording_code_version')],
            },
        ),
        migrations.CreateModel(
            name='Segment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('audience', models.CharField(choices=[('customer', 'Customers'), ('business_owner', 'Businesses')], max_length=20)),
                ('channel', models.CharField(choices=[('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('email', 'Email'), ('inapp', 'In-app')], max_length=10)),
                ('filters', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('archived_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='accounts.staffuser')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='ConsentRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel', models.CharField(choices=[('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('email', 'Email'), ('inapp', 'In-app')], max_length=10)),
                ('status', models.CharField(choices=[('opted_in', 'Opted in'), ('opted_out', 'Opted out')], max_length=10)),
                ('source', models.CharField(choices=[('signup', 'Sign-up form'), ('settings', 'Account settings'), ('checkout', 'Checkout tickbox'), ('unsubscribe_link', 'Stop or unsubscribe link'), ('staff', 'Recorded by staff'), ('handover', 'Hand-over with a scout')], max_length=20)),
                ('source_detail', models.CharField(blank=True, max_length=200)),
                ('wording_text', models.CharField(blank=True, max_length=500)),
                ('ip', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, max_length=200)),
                ('at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('campaign_id', models.PositiveBigIntegerField(blank=True, null=True)),
                ('business_owner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='consent_records', to='accounts.businessowner')),
                ('customer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='consent_records', to='accounts.customer')),
                ('recorded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='accounts.staffuser')),
                ('wording', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='records', to='marketing.consentwording')),
            ],
            options={
                'ordering': ['-at', '-id'],
                'indexes': [models.Index(fields=['customer', 'channel', '-at'], name='marketing_c_custome_5000dd_idx'), models.Index(fields=['business_owner', 'channel', '-at'], name='marketing_c_busines_89720d_idx')],
                'constraints': [models.CheckConstraint(condition=models.Q(models.Q(('business_owner__isnull', True), ('customer__isnull', False)), models.Q(('business_owner__isnull', False), ('customer__isnull', True)), _connector='OR'), name='mk_consent_exactly_one_subject')],
            },
        ),
    ]
