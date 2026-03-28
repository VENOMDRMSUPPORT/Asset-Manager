import re
import unicodedata


def slugify(text: str) -> str:
    """Convert a string into a URL-friendly slug.

    Normalizes unicode characters, converts to lowercase, replaces
    non-alphanumeric sequences with hyphens, and strips leading/trailing
    hyphens.

    Args:
        text: The input string to slugify.

    Returns:
        A lowercase, hyphen-separated slug string.
    """
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text


def truncate(text: str, max_len: int = 100) -> str:
    """Truncate a string to a maximum length, appending an ellipsis if truncated.

    If the string length exceeds max_len, it is cut to max_len - 3 characters
    and '...' is appended so the total length equals max_len.

    Args:
        text: The input string to potentially truncate.
        max_len: Maximum allowed length of the output string (default 100).

    Returns:
        The original string if it fits, otherwise a truncated version with '...'.
    """
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return text[: max_len - 3] + "..."


def word_count(text: str) -> int:
    """Count the number of words in a string.

    Words are defined as non-empty sequences of whitespace-separated tokens.
    Leading, trailing, and consecutive whitespace are ignored.

    Args:
        text: The input string to count words in.

    Returns:
        The number of words in the string.
    """
    return len(text.split())
