# 0028: Liquid classes, their resolver and verification

- Status: accepted
- Date: 2026-09-30
- Plan: 009 (R4, R5, R7, R8, R11; step 009b)

## Context

Plan 009 was accepted with every recommended option. 009b adds liquid classes: per-device settings for aspirating and dispensing each kind of liquid. It also adds the resolver that picks one for a transfer, the rule for a mixture's liquid type, and verification runs.

## Decision

- **`liquid_class`** (`lqc_`, `LQC-0001`). One class is for one instrument model, one device (pipette, head, channel type or chip), optionally particular tip rack types or one Echo source plate type, one dispense mode and a volume range (R7). It serves one or more liquid types. `labDefault` makes it the lab's default for those types on that device and tip. `origin` is a vendor default, the lab's existing class or one made here. Sections: What it is for, Platform settings.
- **Per-platform settings (R5)** are a union on `platform`:
  - `opentrons`: the full transfer properties from Opentrons' liquid class schema 1 (one pipette model and tip rack), typed field by field in Opentrons' units.
  - `hamilton`: the Venus class, with STAR or Vantage, tip volume, CO-RE, needle and filter. It carries an optional read-only copy of the parameters, which may be `hamilton_default` (via PyLabRobot) or the lab's own Venus export. `changedHere` raises a "changed here, apply in Venus" warning until a re-import matches.
  - `echo`: the calibration code, with the full name (`384PP_DMSO2`) as the platform name.
  - `dispenser`: the chip or head as the device.
  - `manual`: forward or reverse, pre-wet, speed.
- **Resolver** (`resolveClass` in `packages/domain`, operation `liquids.resolve_class`). It tries, in order: a class chosen on the step (checked to fit), then the product's `liquidClasses` that fit, then the lab default for the liquid's type that fits, preferring a verified one. Otherwise it returns `none` with the reason and the classes that would fit. Only confirmed classes are used; a draft that would fit is named in the reason. The result always says why and whether the class is verified in this lab.
- **Mixtures (R8)** (`liquids.mixture_type`). The largest part decides, unless a solvent passes its threshold: DMSO at least 70%, glycerol over 20%, ethanol and volatile organics at least 50%. The ethanol and volatile thresholds are this step's choice, since the plan named only DMSO and glycerol. Each part counts fully as its liquid type's base. The result is an assumption until a person or an SOP step sets it.
- **Verification (R11)**. `liquid_class_verification` (`lqv_`, `LQV-0001`) records method, date, target, replicates, mean, CV, the limits the check must meet, raw data and `demo`. `liquids.record_verification` (proposed for agents) returns the result: accuracy is (mean − target) ÷ target, and a run passes within both limits. A class is verified in this lab only with a passing run that is not demo.
- **Drafting and confirming** classes and liquid types use `records.create`, `records.update` and review, as for every kind with sections. The plan's `liquids.draft_class`, `liquids.draft_type` and `liquids.confirm_class` are not separate operations.
- **Deferred**: seed classes (Opentrons shared-data, Hamilton defaults via PyLabRobot, Echo calibrations) are the next PR. `liquids.search_classes` and the class matrix come with the screens (009c).

## Consequences

- The transfer designer (016) calls one operation per transfer and shows its reason. A readiness issue appears when no confirmed class fits.
- Classes never claim accuracy that wasn't measured: demo runs, vendor defaults and unverified classes all say so.
