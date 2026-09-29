# Glossary

Words as this project uses them. Where a word has a lab meaning and an app meaning, both are given.

| Word | Meaning |
| --- | --- |
| **Activate** | Move a draft to active. For kinds with sections it happens when the last section is confirmed |
| **Activity ledger** | The live log of every write outcome (succeeded, failed, proposed, approved, rejected) |
| **Agent** | Any AI acting on behalf of a person: the in-app assistant, Claude Code over MCP, or another model with a token |
| **Agent ink** | The violet used for values an agent set that nobody has confirmed |
| **Agent policy** | Whether an operation lets agents act directly, makes them propose, or decides per call |
| **Assumed** | An agent set this value without naming a source. Stays marked until confirmed |
| **Assay template** | A ready-made experiment design for one assay (ELISA, dose-response…), plan 017 |
| **Campaign** | A lab project with a goal and aims; holds experiments |
| **Capability** | A contract for something an instrument or a person can do (transfer, seal, read luminescence), with limits per kind. Defined in code |
| **Confirm** | A person agreeing to agent work: a section of a draft, or a proposed change |
| **Configuration** | What is physically installed on an instrument now, as an equipment graph on mounts |
| **Container** | A physical, barcoded plate, tube, flask, reservoir, rack or box; an instance of a labware type |
| **Dead volume** | Liquid that can't be pipetted out of a well; depends on who pipettes (Echo, STAR, a person) |
| **Deviation** | Something done differently from the plan during a run, with a reason |
| **Digital SOP** | A structured, versioned procedure with typed steps and variables, built from a library document |
| **Digitizer** | The agent that turns a library document into a draft digital SOP |
| **Draft** | A record in `draft` status: agents edit it freely until a person confirms it |
| **Entity** | What something is: a plasmid, a cell line, a compound. Has a kind with typed fields |
| **Evidence** | Where a value came from: assumed, stated, person, datasheet, imported, measured, calculated |
| **Experiment** | One question and its design inside a campaign; executed as runs |
| **Handling rule** | A typed constraint from the science (max time out of the incubator, light sensitive, freeze-thaw limit), with a source, enforced or advice |
| **Kind** | A record type (`labware_type`), and in the data model the reusable definition layer (the Corning 3570) |
| **Kind, Instance, State** | The rule that definitions, real things and their changing state stay separate |
| **Lab memory** | Conventions, preferences, quirks and lessons agents read and propose; people confirm (plan 005) |
| **Layout template** | A reusable plate pattern: roles by region, replicates, controls, fill order (plan 014) |
| **Liquid class** | Per-device pipetting settings for one tip or source plate, dispense mode and volume range (`384PP_DMSO2` on the Echo) |
| **Liquid type** | Platform-neutral behaviour of a liquid: aqueous, DMSO, 50% glycerol, serum… |
| **Lot** | One batch of a product, bought or made from a recipe, with expiry and CoA values |
| **Manual station** | A bench, hood or hand pipette modeled as an instrument a person operates |
| **Mount** | A named place on an instrument where equipment attaches: a slot, a rail, a surface |
| **Open question** | Something a source leaves unclear, recorded on a draft; blocks confirm until answered |
| **Operation** | A named, typed capability (`records.create`), the only way to read or change data |
| **Plate map** | Which subject goes in which well with what intended contents, across one or more plates (plan 014) |
| **Preview** | Running a write and rolling it back to see what it would do |
| **Proposal** | An agent's change to something active, waiting for a person to confirm or reject |
| **Readable name** | `PREFIX-000123`, the short name people use; for containers it is also the barcode |
| **Readiness** | What is done, missing and assumed in a draft, plus checks with a source and a fix |
| **Recipe** | A lab-made solution with scalable amounts and a preparation SOP |
| **Record** | Anything stored: one envelope, versions, history, links, evidence |
| **Resolver** | Code that picks something and says why: a liquid class for a transfer, the sites of a configuration |
| **Review page** | The one list of everything waiting for a person |
| **Role** (in an SOP) | A named material or instrument with requirements and a default, bound when an experiment is planned |
| **Run** | One execution of an experiment's design on a day |
| **Sample** | A prep the lab made of an entity (a miniprep, a cell bank), with its QC |
| **Section** | A group of fields on a draft that a person confirms together |
| **Set** | A named list of entities or samples one experiment hands to the next |
| **Site** | A place on an instrument where labware can sit |
| **Skill** | A markdown guide in `skills/` that teaches agents a module's operations |
| **Stated** | A value the person told the agent; confirmed with its section like any other |
| **Transfer plan** | How liquid gets from sources to targets: transfers, instruments, liquid classes, decks, worklists (plan 016) |
| **Twin** | A digital simulation of an instrument, sharing capability contracts with the real hardware |
| **Workcell** | An arrangement of instruments and pods served by a transport robot (plan 008d) |
| **Worklist** | A file an instrument's own software runs (Echo CSV, Opentrons protocol) |
