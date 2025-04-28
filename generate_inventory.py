import json
import random
import os
import shutil
# Use numpy for normal distribution if available, otherwise fallback to random
try:
    import numpy as np
    use_numpy = True
except ImportError:
    use_numpy = False
    print("Warning: numpy not found. Using random.normalvariate for popularity (might be slower).")

NUM_SKUS = 20000
OUTPUT_DIR = "data/segments"
POPULARITY_MEAN = 65
POPULARITY_STD_DEV = 15
MIN_POPULARITY = 1
MAX_POPULARITY = 100

# --- Configuration: Possible Attribute Values ---
COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Orange", "Purple", "Gray", "Pink", "Brown", "Cyan"]
SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]
MATERIALS = [
    "Cotton", "Polyester", "Wool", "Silk", "Rayon", "Spandex Blend",
    "Linen", "Denim", "Fleece", "Nylon", "Leatherette", "Corduroy"
]
ITEM_TYPES = ["T-Shirt", "Polo Shirt", "Blouse", "Long-Sleeve Shirt", "Tank Top", "Henley", "Dress Shirt", "Sweater"]
BRANDS = ["BrandA", "BrandB", "BrandC"] # Define Brands

# --- Brand-Specific Prime Mappings ---
# Define primes for attributes within the context of each brand.
# NO master/local split. Brand prime itself is NOT stored here.
BRAND_PRIMES = {
    "BrandA": {
        "attributes": { # Single map for all attributes relevant to SFI calculation
            "color": {"Red": 2, "Blue": 3, "Green": 5, "Yellow": 7, "Black": 11, "White": 13, "Orange": 17, "Purple": 19, "Gray": 23, "Pink": 29, "Brown": 31, "Cyan": 37},
            "size": {"XS": 43, "S": 47, "M": 53, "L": 59, "XL": 61, "XXL": 67, "3XL": 71},
            "material": {"Cotton": 73, "Polyester": 79, "Wool": 83, "Silk": 89, "Rayon": 97, "Spandex Blend": 101, "Linen": 103, "Denim": 107, "Fleece": 109, "Nylon": 113, "Leatherette": 127, "Corduroy": 131}
            # Brand attribute itself is EXCLUDED from SFI calculation primes
        }
    },
    "BrandB": {
        "attributes": {
            "color": {"Red": 13, "Blue": 2, "Green": 3, "Yellow": 5, "Black": 7, "White": 11, "Orange": 31, "Purple": 37, "Gray": 41, "Pink": 43, "Brown": 47, "Cyan": 53},
            "size": {"XS": 59, "S": 61, "M": 67, "L": 71, "XL": 73, "XXL": 79, "3XL": 83},
            "material": {"Cotton": 19, "Polyester": 23, "Wool": 29, "Silk": 101, "Rayon": 103, "Spandex Blend": 107, "Linen": 109, "Denim": 113, "Fleece": 127, "Nylon": 131, "Leatherette": 89, "Corduroy": 97}
        }
    },
    "BrandC": {
         "attributes": {
            "color": {"Red": 5, "Blue": 7, "Green": 11, "Yellow": 13, "Black": 17, "White": 19, "Orange": 23, "Purple": 29, "Gray": 61, "Pink": 67, "Brown": 71, "Cyan": 73},
            "size": {"XS": 3, "S": 79, "M": 83, "L": 89, "XL": 97, "XXL": 101, "3XL": 103},
            "material": {"Cotton": 31, "Polyester": 37, "Wool": 41, "Silk": 43, "Rayon": 47, "Spandex Blend": 53, "Linen": 107, "Denim": 109, "Fleece": 113, "Nylon": 127, "Leatherette": 131, "Corduroy": 59}
        }
    }
    # Add more brands and their prime definitions here
}

# --- Generation Logic ---
def generate_sku(index):
    # Assign a random brand
    brand = random.choice(BRANDS)

    num_colors = random.choices([1, 2], weights=[0.7, 0.3], k=1)[0]
    num_materials = random.choices([1, 2], weights=[0.7, 0.3], k=1)[0]

    selected_colors = random.sample(COLORS, k=num_colors)
    selected_materials = random.sample(MATERIALS, k=num_materials)
    size = random.choice(SIZES)
    item_type = random.choice(ITEM_TYPES)

    # --- REMOVED POPULARITY SCORE GENERATION FOR NOW ---
    # if use_numpy:
    #     raw_popularity = np.random.normal(loc=POPULARITY_MEAN, scale=POPULARITY_STD_DEV)
    # else:
    #     raw_popularity = random.normalvariate(mu=POPULARITY_MEAN, sigma=POPULARITY_STD_DEV)
    # popularity_score = max(MIN_POPULARITY, min(MAX_POPULARITY, int(round(raw_popularity))))

    sku_id = f"SKU{index:05d}"
    color_str = " & ".join(selected_colors)
    material_str = " & ".join(selected_materials)
    name = f"{brand} {size} {color_str} {material_str} {item_type}"

    return {
        "id": sku_id,
        "name": name,
        # "popularity": popularity_score, # REMOVED
        "attributes": {
            "brand": [brand], 
            "color": selected_colors,
            "size": [size],
            "material": selected_materials
        }
    }

# --- Helper to write JSON ---
def write_json(filepath, data):
    dir_name = os.path.dirname(filepath)
    if dir_name and not os.path.exists(dir_name):
        print(f"Creating directory: {dir_name}")
        os.makedirs(dir_name)
    try:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
    except IOError as e:
        print(f"Error writing file {filepath}: {e}")

# --- Main Execution ---
if __name__ == "__main__":
    print(f"Generating {NUM_SKUS} SKUs across {len(BRANDS)} brands...")
    all_inventory = []
    for i in range(NUM_SKUS):
        all_inventory.append(generate_sku(i + 1))

    # Group inventory by brand
    inventory_by_brand = {brand: [] for brand in BRANDS}
    for item in all_inventory:
        brand = item["attributes"]["brand"][0]
        if brand in inventory_by_brand:
            inventory_by_brand[brand].append(item)

    # Clean existing segments directory if it exists
    if os.path.exists(OUTPUT_DIR):
        print(f"Removing existing segments directory: {OUTPUT_DIR}")
        shutil.rmtree(OUTPUT_DIR)

    # Write files for each brand
    print(f"Writing brand-specific files to: {OUTPUT_DIR}")
    for brand, inventory in inventory_by_brand.items():
        if not inventory:
            print(f"Skipping brand {brand}, no items generated.")
            continue

        print(f"Processing {brand} ({len(inventory)} items)...")
        brand_dir = os.path.join(OUTPUT_DIR, brand)

        # Prepare primes JSON content (using the new structure)
        primes_content = {
            "attribute_to_prime": BRAND_PRIMES[brand]["attributes"] # Changed key
        }

        # Write inventory.json (no longer contains popularity)
        inventory_filepath = os.path.join(brand_dir, "inventory.json")
        write_json(inventory_filepath, inventory)

        # Write primes.json
        primes_filepath = os.path.join(brand_dir, "primes.json")
        write_json(primes_filepath, primes_content)

    print("Successfully generated brand-segmented inventory and prime files.") 