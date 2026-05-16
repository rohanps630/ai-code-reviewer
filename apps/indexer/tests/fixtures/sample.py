"""A small fixture for the chunker. Two top-level functions + one
class with a method, plus a top-level constant we expect to fall
outside chunk-worthy nodes."""

API_VERSION = "v1"


def add(a: int, b: int) -> int:
    return a + b


def multiply(a: int, b: int) -> int:
    return a * b


class Calculator:
    """A trivial class with a method."""

    def __init__(self, initial: int = 0) -> None:
        self.value = initial

    def square(self) -> int:
        return self.value * self.value
