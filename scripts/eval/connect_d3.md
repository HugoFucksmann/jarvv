sk-vsr-db3tF0XafeLMTp2fQNXrACmE7iGAwrSGkOD6K3H00Nx

curl -s https://decision.vllm-sr.ai/v1/systemone \
  -H "Authorization: Bearer sk-vsr-db3tF0XafeLMTp2fQNXrACmE7iGAwrSGkOD6K3H00Nx" \
  -H "Content-Type: application/json" \
  -d '{
  "model": "vllm-sr/d3-turbo",
  "state": "Our production app has returned 500 errors since the 09:00 deploy. Customers cannot check out. Please help now.",
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Which team should handle this ticket?",
      "criteria": {
        "billing": "Payments, invoices and refunds",
        "engineering": "Outages, errors and bugs",
        "sales": "Plans, pricing and contracts"
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is this ticket?",
      "criteria": ["Low", "Normal", "Urgent"]
    }
  }
}'
