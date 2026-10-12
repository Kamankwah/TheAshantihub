from django.db import migrations

MONDAY_TO_SATURDAY = [0, 1, 2, 3, 4, 5]


def keep_monday_to_saturday(apps, schema_editor):
    """Support's default became Monday to Friday. Existing Support staff were
    judged on Monday to Saturday, so give each one without a saved pattern that
    pattern explicitly: the new default then applies to people added later and
    no past day changes."""
    StaffUser = apps.get_model("accounts", "StaffUser")
    WorkPattern = apps.get_model("targets", "WorkPattern")
    for staff in StaffUser.objects.filter(role__name="support", work_pattern__isnull=True):
        WorkPattern.objects.create(
            staff=staff, weekdays=MONDAY_TO_SATURDAY, set_by_id=staff.manager_id or staff.pk,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("targets", "0002_leave_kinds"),
        ("accounts", "0043_staff_invite_start_date_areas"),
    ]

    operations = [migrations.RunPython(keep_monday_to_saturday, migrations.RunPython.noop)]
