"""A phone's passkey in software, for tests: it answers the server's WebAuthn challenges the way a real phone does
(an ECDSA P-256 key, "none" attestation), so sign-in is tested end to end without a device."""
import base64
import hashlib
import json
import secrets

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class SoftKey:
    def __init__(self, rp_id: str = "testserver", origin: str = "http://testserver") -> None:
        self.rp_id, self.origin = rp_id, origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(16)
        self.counter = 0
        self.user_handle: str | None = None

    def _cose_public_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")})

    def create(self, options: dict) -> dict:
        """navigator.credentials.create(): a new key for the user in options."""
        self.user_handle = options["user"]["id"]
        client_data = json.dumps({"type": "webauthn.create", "challenge": options["challenge"], "origin": self.origin,
                                  "crossOrigin": False}).encode()
        auth_data = (hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x45])  # user present + verified + key data
                     + (0).to_bytes(4, "big") + bytes(16) + len(self.credential_id).to_bytes(2, "big")
                     + self.credential_id + self._cose_public_key())
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client_data), "attestationObject": b64(attestation), "transports": ["internal"]},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}

    def get(self, options: dict, origin: str | None = None) -> dict:
        """navigator.credentials.get(): sign the server's challenge."""
        self.counter += 1
        client_data = json.dumps({"type": "webauthn.get", "challenge": options["challenge"],
                                  "origin": origin or self.origin, "crossOrigin": False}).encode()
        auth_data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x05]) + self.counter.to_bytes(4, "big")
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client_data), "authenticatorData": b64(auth_data), "signature": b64(signature),
                             "userHandle": self.user_handle},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}
