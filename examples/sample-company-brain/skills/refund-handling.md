---
name: refund-handling
description: Execute the source-cited Refund Handling workflow safely with approval gates.
---

# Refund Handling

Use this skill when an agent needs to help with refund handling for this company.

## Agent Procedure

1. Support agent checks Zendesk ticket history, Stripe charge status, and account notes.
2. Support agent summarizes evidence and prepares the recommended refund decision.
3. Refund requests above $750 require Founder approval before changing Stripe. Before doing this, get explicit human approval.

## Requires Human Approval

- Refund requests above $750 require Founder approval before changing Stripe.

## Stop Conditions

- Stop if source evidence conflicts or the current source freshness is unclear.
- Stop if the requested action would change customer, billing, production, security, or external systems without explicit human approval.

## Output Format

- State what evidence was used.
- State the recommended next action.
- State whether the next action is read-only or approval-gated.
