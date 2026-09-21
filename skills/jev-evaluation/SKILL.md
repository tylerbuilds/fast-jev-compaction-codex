---
name: jev-evaluation
description: Use TypeSafe Jev for calibrated boolean, choice, and score judgements over supplied text or JSON state. Use for workflow triage, classification, risk assessment, prioritisation, or repeatable evaluation when typed probabilities are more useful than free-form prose.
---

# Jev evaluation

Use the `jev_evaluate` MCP tool when a workflow needs one or more structured
judgements over the same state. Prefer `noul` for a calibrated true probability,
`choice` for one named category with probabilities, and `score` for an ordered
scale with a legend and confidence.

The tool sends the supplied state and question instructions to the direct
TypeSafe API by default. Before calling it, make sure the user has
authorised that external transmission and set `confirmExternalTransmission:
true`. Do not include credentials, tokens, cookies, private personal data, or
other sensitive material unless the user has explicitly approved that specific
transmission.

Keep each question independently answerable from the state. Put the decision
rule in `instructions`, and use `criteria` to define what each boolean outcome,
choice, or score level means. Treat returned probabilities and confidence as
decision support rather than proof. Report the model answer and uncertainty,
and retain human gates for destructive, financial, production, publication, or
security-sensitive actions.
