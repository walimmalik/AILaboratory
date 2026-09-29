# Worklist examples (mock)

Example files for the transfer designer (plan 016): what it writes for each instrument, and what the Echo sends back. Every file here is a **mock**, made up on 2026-09-29 because the lab has no exports yet. They drive the worklist writers' golden-file tests until real files replace them, and none of them has been run on an instrument (rule 10).

The scenarios follow the seed lab: the single-point compound screen and dose-response (`assays.yaml`, `sops/own/compound-screen-echo.md`) and the IL-6 ELISA (`sops/own/elisa-il6-duoset.md`). Barcodes use the 010 V5 format (`PLT-000201`).

| File | Instrument | What it shows | Status |
| --- | --- | --- | --- |
| `echo-pick-list-single-point.csv` | Echo 650 | Single-point screen, first 32 compounds of one assay plate: DMSO into columns 1 and 2, 25 nL of 10 mM stock per compound, staurosporine into 23 and 24 | Columns stated by Wali. Destination plate type name `Corning_384_3570` estimated |
| `echo-pick-list-dose-response.csv` | Echo 650 | Dose-response for one compound in duplicate: the source plate holds a 10-point 3-fold series in DMSO (A1 to J1), 25 nL of each, so every well gets the same DMSO and no backfill | Same as above |
| `echo-transfer-report.csv` | Echo 650 | The report read back after a run: actual volume and status per transfer, one short and one failed well | Columns and status texts estimated |
| `echo-survey-report.csv` | Echo 650 | Source plate survey: volume and DMSO content per well | Columns and status texts estimated |
| `opentrons-flex-elisa-standards.py` | Opentrons Flex | ELISA standards made by 2-fold serial dilution, then standards, blanks and samples in duplicate; tip use set in the protocol | API calls follow the Opentrons Python API 2.20; load names estimated |
| `hamilton-star-worklist.csv` | Hamilton STAR | ELISA samples from a tube rack into the plate in duplicate, for a generic lab Venus method; `NewTip` column the method obeys | Whole format made up: it is whatever the lab's own method reads (a worklist format record, 016 T1) |
| `hamilton-vantage-worklist.csv` | Hamilton Vantage | Medium addition from a reservoir into a 384-well plate (excerpt) | Whole format made up, as above |
| `mantis-dispense-grid.csv` | Formulatrix Mantis | Cells into every well of a 384-well plate except column 24, as one volume grid per reagent | Whole format made up |
| `precisedrop-dispense-list.csv` | PreciseDrop II | CellTiter-Glo into a 96-well plate as a well list | Whole format made up |

The CyBio FeliX stamps whole plates with its 96 head, so it has no per-well worklist; its method settings come with 016c.

## Echo pick list columns

As Wali described the lab's Echo 650 pick list (2026-09-29): Source Plate Name, Source Plate Barcode, Source Plate Type, Source Well, Transfer Volume (nL), Destination Plate Name, Destination Plate Barcode, Destination Plate Type, Destination Well. The source plate type is the plate type joined with the calibration, as in 009 R12 (`384PP_DMSO2`, `384LDV_DMSO2`).

## Why the dose-response source holds a series

Direct dispense from a few stocks (10, 1, 0.1, 0.01 mM) can't hit a 3-fold series in 2.5 nL droplets: the achieved concentrations land 10 to 97% off target at the low points. That is the kind of result `transfers.dilution_options` (016 T2) must compute and show, so the agent proposes an intermediate series plate instead.

## Replacing a mock

When a real export exists, put it next to the mock with the same scenario, mark it real in the table, and delete the mock. Formats marked "made up" are drafted into worklist format records from the real file and confirmed by a person.
