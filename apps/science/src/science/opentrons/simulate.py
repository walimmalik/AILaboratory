"""Simulates the protocol on standard input; prints one line of JSON (a Check) last.

Run by `check` in its own process: the simulator executes the protocol, and its logging and
state stay out of the service.
"""

import io
import re
import sys
from importlib.metadata import version


def main() -> None:
    from science.opentrons.protocol import Check

    protocol = sys.stdin.read()
    simulator = version("opentrons")
    try:
        from opentrons.simulate import simulate

        runlog, _ = simulate(io.StringIO(protocol), file_name="protocol.py")
    except Exception as error:  # the simulator raises many kinds; each is a problem to report
        print(
            Check(
                ok=False, simulator=simulator, commands=0, tips=0, problem=_plain(error)
            ).model_dump_json(by_alias=True)
        )
        return
    tips = sum(1 for entry in runlog if entry["payload"]["text"].startswith("Picking up tip"))
    print(
        Check(ok=True, simulator=simulator, commands=len(runlog), tips=tips).model_dump_json(
            by_alias=True
        )
    )


def _plain(error: Exception) -> str:
    """The simulator's first error, without its records and the protocol line it ran."""
    text = str(error)
    details = [d for _, d in re.findall(r"detail=(['\"])(.*?)\1", text)]
    if not details:
        return f"{type(error).__name__}: {text}"[:1000]
    first = re.sub(r" \[line \d+\]:?", "", details[0]).strip().rstrip(":")
    first = re.sub(r"^Error 4000 GENERAL_ERROR \(ProtocolCommandFailedError\): ", "", first)
    return first[:1000]


if __name__ == "__main__":
    main()
