from django.db import migrations

# The six partners that were hardcoded in frontend/components/dashboard/
# theme.js (LENDING_PARTNERS), moved into the DB so the business CreditPanel
# and the new staff panel share one source of truth and neither starts empty.
# Idempotent on `name` so re-running (or running after a partner already
# exists) doesn't duplicate.
PARTNERS = [
    dict(name="Fidelity Bank Ghana", partner_type="bank", logo="🏦", color="#3a7afe",
         min_score=600, max_loan="GHS 50,000", interest_rate="18–24% p.a.",
         turnaround="3–5 days", focus="SME Business Loans", contact="0302 214 460"),
    dict(name="Sinapi Aba Savings & Loans", partner_type="microfinance", logo="🌱", color="#34d399",
         min_score=400, max_loan="GHS 10,000", interest_rate="24–36% p.a.",
         turnaround="1–2 days", focus="Micro & Small Business", contact="0322 495 822"),
    dict(name="Opportunity International Ghana", partner_type="ngo", logo="🤝", color="#fb923c",
         min_score=350, max_loan="GHS 5,000", interest_rate="20–28% p.a.",
         turnaround="2–3 days", focus="Women & Youth Businesses", contact="0302 785 960"),
    dict(name="ARB Apex Bank", partner_type="bank", logo="🏛️", color="#f472b6",
         min_score=500, max_loan="GHS 25,000", interest_rate="20–26% p.a.",
         turnaround="3–7 days", focus="Rural & Informal Business", contact="0322 022 328"),
    dict(name="Absa Ghana SME", partner_type="bank", logo="🔴", color="#f87171",
         min_score=650, max_loan="GHS 100,000", interest_rate="16–22% p.a.",
         turnaround="5–7 days", focus="Established Businesses", contact="0302 429 150"),
    dict(name="Ghana Enterprise Agency", partner_type="government", logo="🇬🇭", color="#34d399",
         min_score=300, max_loan="GHS 20,000", interest_rate="0% (Grant)",
         turnaround="2–4 weeks", focus="SME Development Grants", contact="0302 685 132"),
]


def seed(apps, schema_editor):
    LendingPartner = apps.get_model("credit", "LendingPartner")
    for partner in PARTNERS:
        LendingPartner.objects.get_or_create(name=partner["name"], defaults=partner)


def unseed(apps, schema_editor):
    LendingPartner = apps.get_model("credit", "LendingPartner")
    LendingPartner.objects.filter(name__in=[p["name"] for p in PARTNERS]).delete()


class Migration(migrations.Migration):
    dependencies = [("credit", "0002_lendingpartner_creditscore_adjusted_at_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
