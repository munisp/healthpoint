from passlib.context import CryptContext

try:
    print("Creating CryptContext...")
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    print("CryptContext created.")
    
    password = "admin_password"
    print(f"Hashing password: {password}")
    
    hashed_password = pwd_context.hash(password[:72])
    print("Hashing successful.")
    print(f"Hashed password: {hashed_password}")

except Exception as e:
    import traceback
    print(f"An error occurred: {e}")
    traceback.print_exc()
