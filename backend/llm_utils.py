import requests
import json
import os
from dotenv import load_dotenv

# Ensure dotenv is loaded to read API keys from backend/.env
load_dotenv()

def format_prompt(text, required_fields):
    """
    Formats the prompt for the LLM to extract the specific list of fields from the insurance report text.
    """
    fields_list_str = "\n".join(f"- {field}" for field in required_fields)
    
    prompt = (
        "You are an expert insurance claims assistant. "
        "Your task is to extract values from the provided insurance report text to populate a claims template.\n\n"
        "Here is the list of fields you MUST extract (please use these EXACT field names as keys in your JSON response):\n"
        f"{fields_list_str}\n\n"
        "### Key Definitions & Guidelines:\n"
        "- If a field is prefixed with 'XM8_', it represents an Xactimate format field (e.g., 'XM8_INSURED_NAME' matches the Insured's Name).\n"
        "- For dates:\n"
        "  - 'DATE_LOSS' or 'XM8_DATE_LOSS' -> Date of loss/damage.\n"
        "  - 'DATE_INSPECTED' or 'XM8_DATE_INSPECTED' -> Date the physical inspection took place.\n"
        "  - 'DATE_RECEIVED' or 'XM8_DATE_RECEIVED' -> Date of assignment/referral received by the service provider.\n"
        "  - 'XM8_DATE_CURRENT' -> Today's date or the date the report was compiled.\n"
        "- For name and address:\n"
        "  - 'INSURED_NAME' or 'XM8_INSURED_NAME' -> Name of the insured client/member.\n"
        "  - 'INSURED_H_STREET' or 'XM8_INSURED_P_STREET' -> Loss street address.\n"
        "  - 'INSURED_H_CITY' or 'XM8_INSURED_P_CITY' -> Loss city.\n"
        "  - 'INSURED_H_STATE' or 'XM8_INSURED_P_STATE' -> Loss state.\n"
        "  - 'INSURED_H_ZIP' or 'XM8_INSURED_P_ZIP' -> Loss ZIP code.\n"
        "- For company information:\n"
        "  - 'CARRIER_NAME' -> Insurance company name (e.g. USAA, GuideOne).\n"
        "  - 'POLICY_NO' -> Policy number.\n"
        "  - 'MORTGAGEE' or 'MORTGAGE_CO' -> Mortgage company/lender (e.g. PennyMac).\n"
        "  - 'TOL_CODE' or 'XM8_TOL_DESC' -> Type of Loss / Cause (e.g. Wind, Hail, Water).\n"
        "  - 'SERVICE_PROVIDER' -> Name of the vendor doing the inspection (e.g. Alacrity Solutions).\n\n"
        "### Output Format:\n"
        "Return ONLY a valid JSON object mapping these exact fields to their extracted values. "
        "Do not include any pre-text, explanation, post-text, or markdown formatting blocks (like ```json). "
        "If a field is not found in the text, map it to an empty string \"\".\n\n"
        f"Report Text:\n{text}\n\nKey-Value Pairs (JSON):"
    )
    return prompt

def call_gemini_api(prompt, api_key, model="gemini-3.5-flash"):
    """Call Google Gemini API directly using requests (Free tier)."""
    # Strip any prefix like "google/" or "models/" if sent by the frontend
    cleaned_model = model.split("/")[-1]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cleaned_model}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    response = requests.post(url, headers=headers, json=data, timeout=60)
    response.raise_for_status()
    result = response.json()
    reply = result["candidates"][0]["content"]["parts"][0]["text"]
    return reply

def call_groq_api(prompt, api_key, model="llama3-8b-8192"):
    """Call Groq API directly (Free tier)."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.1
    }
    response = requests.post(url, headers=headers, json=data, timeout=60)
    response.raise_for_status()
    result = response.json()
    reply = result["choices"][0]["message"]["content"]
    return reply

def call_openrouter_api(prompt, api_key, model="openai/gpt-3.5-turbo"):
    """Call OpenRouter API."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1500,
        "temperature": 0.1
    }
    response = requests.post(url, headers=headers, json=data, timeout=60)
    response.raise_for_status()
    result = response.json()
    reply = result["choices"][0]["message"]["content"]
    return reply

def extract_key_value_pairs(text, api_key, required_fields, provider="openrouter", model="openai/gpt-3.5-turbo"):
    """
    Directs key-value extraction to the selected provider (Gemini, Groq, OpenRouter).
    Automatically falls back to server env variables if api_key is empty or 'default'.
    """
    # 1. Resolve API Key (check server environment if key is missing or 'default')
    resolved_key = api_key
    if not resolved_key or resolved_key.strip() == "" or resolved_key.lower() == "default":
        if provider == "gemini":
            resolved_key = os.getenv("GEMINI_API_KEY")
        elif provider == "groq":
            resolved_key = os.getenv("GROQ_API_KEY")
        else:
            resolved_key = os.getenv("OPENROUTER_API_KEY")
            
    if not resolved_key:
        return {}, f"API Error: API Key is missing for provider '{provider}'. Please configure it in .env or enter it in the settings panel."

    prompt = format_prompt(text, required_fields)
    
    try:
        # 2. Call selected Provider API
        if provider == "gemini":
            reply = call_gemini_api(prompt, resolved_key)
        elif provider == "groq":
            # Map standard model choice to Groq models
            groq_model = "llama-3.1-8b-instant" if "flash" in model.lower() or "3.5" in model.lower() else "llama3-8b-8192"
            reply = call_groq_api(prompt, resolved_key, model=groq_model)
        else:
            reply = call_openrouter_api(prompt, resolved_key, model=model)
            
        # 3. Parse reply as JSON
        try:
            key_value_pairs = json.loads(reply)
        except json.JSONDecodeError:
            import re
            match = re.search(r'\{.*\}', reply, re.DOTALL)
            if match:
                try:
                    key_value_pairs = json.loads(match.group(0))
                except Exception as e:
                    print(f"Error parsing extracted JSON: {e}")
                    key_value_pairs = {}
            else:
                print("LLM response is not valid JSON.")
                key_value_pairs = {}
                
        # Fill any missing required fields with empty string
        for field in required_fields:
            if field not in key_value_pairs:
                found = False
                for k, v in key_value_pairs.items():
                    if k.lower() == field.lower():
                        key_value_pairs[field] = v
                        found = True
                        break
                if not found:
                    key_value_pairs[field] = ""
                    
        return key_value_pairs, reply
    except Exception as e:
        print(f"Error communicating with LLM API: {e}")
        return {}, f"API Error: {e}"
