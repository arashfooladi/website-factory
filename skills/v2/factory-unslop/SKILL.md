---
name: factory-unslop
description: Apply counted, evidence-based Unslop calibration profiles while preserving the client's reference fidelity and functional requirements.
metadata:
  version: "2.0.0"
---

Factory adaptation of mshumer/unslop's visual workflow. The upstream pack and script are pinned in skills/vendor/unslop. The trusted controller generates bounded samples, renders them, analyzes repeated patterns with source and screenshot evidence, then compares a held-out before/after example. Do not run the upstream host CLI from an agent task.

If an empirical profile is assigned, read its provider, model, domain, sample count, counted patterns and comparison caveats. Apply its specific avoidance rules to free/adapted axes; the client's explicit style and matched reference axes win. Avoidance rules must not impose a replacement stock aesthetic. Change a repeated pattern for a reason grounded in this client and the page's purpose.

If no empirical profile is assigned, do not claim calibration happened. Use the supplied design brief and craft instructions, inspect the actual renders and record that the model/domain profile is pending. Never invent sample counts or before/after improvements. A profile from a different model/domain is not evidence about this one.

In critique, identify concrete repeated defaults and their location in screenshot/HTML evidence. Explain how they conflict with a free axis or the client's direction. A familiar cart or checkout pattern that makes shopping easier is not a defect merely because it is common. Do not alter protected functional/admin/commerce behavior to make a page unusual.
