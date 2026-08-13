"""Known disposable / throwaway email domains (lowercase)."""

DISPOSABLE_DOMAINS = frozenset(
    {
        '10minutemail.com',
        'tempmail.com',
        'temp-mail.org',
        'guerrillamail.com',
        'guerrillamail.org',
        'mailinator.com',
        'yopmail.com',
        'trashmail.com',
        'sharklasers.com',
        'getnada.com',
        'maildrop.cc',
        'discard.email',
        'mailnesia.com',
        'throwaway.email',
        'tempail.com',
        'fakeinbox.com',
        'emailondeck.com',
        'mintemail.com',
        'moakt.com',
        'tmpmail.org',
        'tmpmail.net',
        'dispostable.com',
        'mailcatch.com',
        'mytemp.email',
        'tempinbox.com',
    }
)


def is_disposable_email(email: str) -> bool:
    email = (email or '').strip().lower()
    if '@' not in email:
        return False
    domain = email.rsplit('@', 1)[-1]
    if domain in DISPOSABLE_DOMAINS:
        return True
    # Block obvious plus-alias farms on disposable roots only; normal Gmail +tag still allowed.
    return False
