import os
import json
import pandas as pd

csv_path = "static/save_data/dataset.csv"
df_dataset = pd.read_csv(csv_path)

# Step 2: Prepare list to collect records
data_records = []

# Step 3: Iterate each row and parse files
for _, row in df_dataset.iterrows():
    user_id = row["user_id"]
    gender = row["gender"]
    trial = row["trial"]
    json_path = row["json_path"]
    arduino_path = row["arduino_path"]
    accel_path = row["accel_path"]

    try:
        # Load JSON data
        with open(json_path, 'r') as f_json:
            collected_data = json.load(f_json)

        # Load Arduino and Accel logs
        arduino_df = pd.read_csv(arduino_path)
        accel_df = pd.read_csv(accel_path)

        # Extract info from collected_data
        vib_signal = collected_data.get("vib_signal", [])
        accle_signal = accel_df.to_dict(orient="records")  # List of dicts
        arduino_log = arduino_df.to_dict(orient="records")  # List of dicts

        sample_rate = collected_data.get("sample_rate", "")
        duration = collected_data.get("duration", "")
        body_sites = collected_data.get("body_sites", {})
        ratings = collected_data.get("ratings", {})

        # Combine into one record
        data_records.append({
            "user_id": user_id,
            "gender": gender,
            "trial": trial,
            "sample_rate": sample_rate,
            "duration": duration,
            "vibrationInfo": body_sites.get("vibrationInfo", ""),
            "thermalInfo": body_sites.get("thermalInfo", ""),
            "roughness": ratings.get("roughness", ""),
            "valence": ratings.get("valence", ""),
            "arousal": ratings.get("arousal", ""),
            "referral": ratings.get("referral", ""),
            "masking": ratings.get("masking", ""),
            "vib_signal": vib_signal,
            "accle_signal": accle_signal,
            "arduino_log": arduino_log
        })

    except Exception as e:
        print(f"[Error] user {user_id}, trial {trial} -> {e}")

# Step 4: Save as CSV and JSON
df_flat = pd.DataFrame(data_records)
df_flat.to_csv("total_data.csv", index=False)
df_flat.to_json("total_data.json", orient="records", lines=True)

print(f"✅ 저장 완료: 총 {len(data_records)}개의 trial이 통합됨 (dataset.csv 내 gender 반영)")
