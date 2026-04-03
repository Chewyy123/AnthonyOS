import os
from email import message_from_bytes
from email.header import decode_header, make_header
from typing import Any, Dict, List

from imapclient import IMAPClient
from dotenv import load_dotenv

load_dotenv()

YAHOO_EMAIL = os.getenv("YAHOO_EMAIL")
YAHOO_APP_PASSWORD = os.getenv("YAHOO_APP_PASSWORD")

IMAP_HOST = "imap.mail.yahoo.com"
IMAP_PORT = 993


def _decode_header_value(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _extract_plain_text(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            if content_type == "text/plain" and "attachment" not in content_disposition.lower():
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                if payload:
                    try:
                        return payload.decode(charset, errors="ignore")
                    except Exception:
                        return payload.decode("utf-8", errors="ignore")
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        if payload:
            try:
                return payload.decode(charset, errors="ignore")
            except Exception:
                return payload.decode("utf-8", errors="ignore")

    return ""


def summarize_yahoo_inbox(max_results: int = 10) -> Dict[str, Any]:
    if not YAHOO_EMAIL or not YAHOO_APP_PASSWORD:
        raise ValueError("YAHOO_EMAIL or YAHOO_APP_PASSWORD missing from .env")

    with IMAPClient(IMAP_HOST, port=IMAP_PORT, ssl=True) as client:
        client.login(YAHOO_EMAIL, YAHOO_APP_PASSWORD)
        client.select_folder("INBOX")

        unread_ids = client.search(["UNSEEN"])
        all_ids = client.search(["ALL"])

        recent_ids = sorted(all_ids, reverse=True)[:max_results]
        if not recent_ids:
            return {
                "unreadCount": len(unread_ids),
                "emails": [],
            }

        fetched = client.fetch(recent_ids, ["RFC822", "FLAGS"])

        emails: List[Dict[str, str]] = []

        for msg_id in sorted(fetched.keys(), reverse=True):
            raw = fetched[msg_id][b"RFC822"]
            msg = message_from_bytes(raw)

            subject = _decode_header_value(msg.get("Subject", ""))
            sender = _decode_header_value(msg.get("From", ""))
            body = _extract_plain_text(msg).strip()
            snippet = body[:250].replace("\n", " ").strip()

            emails.append(
                {
                    "id": str(msg_id),
                    "subject": subject,
                    "from": sender,
                    "snippet": snippet,
                    "body": body[:1500],
                }
            )

        return {
            "unreadCount": len(unread_ids),
            "emails": emails,
        }