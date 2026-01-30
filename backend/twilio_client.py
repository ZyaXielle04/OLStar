from twilio.rest import Client
import os
from dotenv import load_dotenv
load_dotenv()

ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER")

if not all([ACCOUNT_SID, AUTH_TOKEN, TWILIO_NUMBER]):
    raise RuntimeError("Missing Twilio environment variables")

client = Client(ACCOUNT_SID, AUTH_TOKEN)

def send_sms(to, body):
    return client.messages.create(
        from_=TWILIO_NUMBER,
        to=to,
        body=body
    )

def send_whatsapp(to, body):
    return client.messages.create(
        from_="whatsapp:" + TWILIO_NUMBER,
        to="whatsapp:" + to,
        body=body
    )
