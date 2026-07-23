# Real response-rate + last-online — implementation spec (owner-requested 2026-07-23)

Owner chose "build both for real". Both are honesty-gated: response rate is a fabricated
=100 default today (RESPONSE_METRIC_IS_REAL=false suppresses it); last-online does not
exist for marketplace sellers. NOTHING may surface until computed from real data. This
spec was produced by a mapping+design workflow verified against the live files.

