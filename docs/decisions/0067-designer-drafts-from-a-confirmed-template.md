# 0067: The designer drafts from a confirmed template, in one write

- Status: accepted
- Date: 2026-10-01
- Plan: 017 (017b-1)

## Context

Plan 017 D3 says the designer asks only a template's essential inputs and fills the rest from the template and lab memory, marked as such. P1 says the experiment, its plate maps and its transfer plans are drafted together but reviewed and confirmed one by one. Rule 3 says downstream work uses confirmed versions only.

## Options

1. Draft whatever is possible, with missing inputs left blank for the person to fill.
2. Refuse until every essential input is answered, and draft everything in one write once they are.
3. A multi-step session that keeps partial answers on the server.

## Decision

Option 2. `designer.start` takes a template, the campaign (and aim), and the answers:

- **Confirmed version only.** The template version must be one a person confirmed. The experiment pins it (`template: {id, version}`, linked `from_template`), and the experiment kind refuses an unconfirmed pin.
- **Nothing half-drafted.** Missing essential inputs refuse the call with "Still needed: …". `assays.design` lists them beforehand, so the agent asks the person only for those.
- **What is drafted.** The experiment drafts in one write. It gets the template's SOP versions, with the default records bound by version (by id for containers, samples and instruments), and the answered variables as inputs. It also gets the subjects, one condition per factor with its levels, the controls whose well role an experiment can name, the readouts and the quality criteria as success criteria.
  - **Plate map.** When the template has a layout and the only factor is the subjects, given as records, the plate map is drafted too. It carries the layout's control regions and the template's default plate type.
  - **Transfer plans.** These wait for the sources and the dispensing instrument, so they are drafted with 016's operations.
- **Marking.** Values taken from the template carry `template` evidence from the confirmed version, which the record service checks. A question defaulted from the template's purpose is marked assumed.

## Consequences

- An agent can design an experiment in one call, and the person reviews each draft on its own page.
- A template with several factors gets an experiment but no plate map yet. Placement of crossed factors comes with the design page (017b-2) through 014's strategies.
- `designer.missing` from the plan is `assays.design`, which already lists what is still needed.
