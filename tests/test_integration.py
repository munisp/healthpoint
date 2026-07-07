import requests

def test_gfe_to_idr_flow():
    # 1. Generate GFE
    gfe_response = requests.post("http://localhost:8027/api/v1/gfe/generate", json={"patient": {"firstName": "John", "lastName": "Doe", "dateOfBirth": "1990-01-01"}})
    assert gfe_response.status_code == 200
    gfe_id = gfe_response.json()["gfeId"]

    # 2. Submit claim
    claim_response = requests.post("http://localhost:8028/api/v1/x12/837/process", json={"claim_data": "..."})
    assert claim_response.status_code == 200

    # 3. Initiate dispute
    dispute_response = requests.post("http://localhost:8030/api/v1/idr/dispute/initiate", json={"dispute_data": "..."})
    assert dispute_response.status_code == 200

    # 4. Submit to CMS
    cms_response = requests.post("http://localhost:8029/api/v1/cms/ppdr/submit", json={"submission_data": "..."})
    assert cms_response.status_code == 200

