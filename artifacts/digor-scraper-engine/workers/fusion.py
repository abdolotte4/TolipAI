import re
from collections import Counter
from typing import Dict, List

class FusionEngine:
    def __init__(self, markdown: str):
        self.markdown = markdown

    def extract_phones(self) -> List[str]:
        phones = re.findall(r'\d{3}[-\.\s]??\d{3}[-\.\s]??\d{4}|\(\d{3}\)\s*\d{3}[-\.\s]??\d{4}|\d{3}[-\.\s]??\d{4}', self.markdown)
        return phones

    def extract_addresses(self) -> List[str]:
        addresses = re.findall(r'\b(?:[0-9]+ )?[0-9]+(?: [A-Za-z]+)*,? (?:Apt|Suite|Unit)? ?[A-Za-z0-9]+(?: [A-Za-z0-9]+)*\b', self.markdown)
        return addresses

    def assign_confidence(self, data: Dict[str, int]) -> Dict[str, str]:
        confidence = {}
        for key, value in data.items():
            if value >= 3:
                confidence[key] = 'high'
            elif value == 2:
                confidence[key] = 'medium'
            else:
                confidence[key] = 'low'
        return confidence

    def get_top_results(self, data: Dict[str, int], n: int = 5) -> List[str]:
        return [key for key, value in Counter(data).most_common(n)]

    def run(self) -> Dict[str, List[str]]:
        phones = self.extract_phones()
        addresses = self.extract_addresses()
        phone_counts = Counter(phones)
        address_counts = Counter(addresses)
        phone_confidence = self.assign_confidence(dict(phone_counts))
        address_confidence = self.assign_confidence(dict(address_counts))
        top_phones = self.get_top_results(phone_counts)
        top_addresses = self.get_top_results(address_counts)
        return {
            'phones': top_phones,
            'addresses': top_addresses,
            'phone_confidence': phone_confidence,
            'address_confidence': address_confidence
        }
