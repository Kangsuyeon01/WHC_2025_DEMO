import csv
import os
import csv
import os
def save_user_info(name, experiment_id, gender):
    os.makedirs("static/save_data", exist_ok=True)
    file_path = "static/save_data/users.csv"

    existing_user = False
    trial_number = 1
    previous_gender = None

    # 사용자 정보 확인
    if os.path.exists(file_path):
        with open(file_path, "r", newline='', encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["user_id"] == experiment_id:
                    if row["name"] != name:
                        return False, None, None  # 이름-ID 불일치
                    existing_user = True
                    previous_gender = row["gender"]
                    break

    # 사용자 디렉토리에서 trial 개수 확인
    user_dir = f"static/save_data/{experiment_id}"
    if os.path.exists(user_dir):
        trial_number = len([
            d for d in os.listdir(user_dir)
            if os.path.isdir(os.path.join(user_dir, d)) and d.isdigit()
        ]) + 1
    else:
        os.makedirs(user_dir + "/logs", exist_ok=True)

    # 새 사용자면 users.csv에 추가
    if not existing_user:
        with open(file_path, "a", newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=["name", "user_id", "gender"])
            if f.tell() == 0:
                writer.writeheader()
            writer.writerow({
                "name": name,
                "user_id": experiment_id,
                "gender": gender
            })

    return True, trial_number, previous_gender
