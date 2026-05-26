---
name: Twilio TwiML transcribe attr on Conference
description: transcribe/transcribeCallback on Conference element causes Error 12200
---
Twilio Error 12200 (XML Validation) fires when transcribe="true" is on a <Conference> element without a valid Voice Intelligence service SID configured in the Twilio account.
Fix: transcribeAttr is now conditional on TWILIO_VOICE_INTELLIGENCE_SID env var. When not set, attr is empty string — Conference elements have no transcription attrs.
The /twilio/voice/join-conference endpoint had this hardcoded; it's now removed entirely from that endpoint.
