#include "primekit.h"
#include <emscripten/bind.h>
#include <iostream> // For potential debugging
#include <numeric>  // Not strictly needed for this impl, but useful potentially
#include <limits>   // For UINT64_MAX

// --- PrimeKit Implementation ---

PrimeKit::PrimeKit() {
    // Initialize hardcoded prime dictionaries based on data/primes.json structure
    // Master Primes (e.g., only 'color')
    master_primes_["color"] = {{"red", 2}, {"blue", 3}, {"green", 5}};
    // Add other master attributes and primes here if needed

    // Local Primes (e.g., 'size', 'material')
    local_primes_["size"] = {{"S", 7}, {"M", 11}, {"L", 13}};
    local_primes_["material"] = {{"cotton", 17}, {"polyester", 19}, {"wool", 23}};
    // Add other local attributes and primes here if needed

    // Define which attribute keys belong to which SFI tier
    master_attribute_keys_ = {"color"};
    local_attribute_keys_ = {"size", "material"};
}

// Helper to get prime, returns 1 (neutral element for multiplication) if not found
uint64_t PrimeKit::get_prime(const PrimeDictionary& dict, const std::string& key, const std::string& value) {
    auto key_it = dict.find(key);
    if (key_it != dict.end()) {
        auto value_it = key_it->second.find(value);
        if (value_it != key_it->second.end()) {
            // Basic check: ensure prime is actually greater than 1
            if (value_it->second > 1) {
                return value_it->second;
            }
        }
    }
    // Optional: Add warning/error logging here if a prime is missing
    // std::cerr << "Warning: Prime not found or invalid for key: " << key << ", value: " << value << std::endl;
    return 1; // Return 1 if attribute or value is not found or invalid
}

// Encodes SFI based on selected attributes and primes
uint64_t PrimeKit::encode_sfi(const ItemData& attributes, const std::vector<std::string>& relevant_keys, const PrimeDictionary& prime_dict) {
    uint64_t sfi = 1;
    const uint64_t max_val = std::numeric_limits<uint64_t>::max();

    for (const std::string& key : relevant_keys) {
        auto attr_it = attributes.find(key);
        if (attr_it != attributes.end()) {
            uint64_t prime = get_prime(prime_dict, key, attr_it->second);

            if (prime > 1) {
                // Check for potential overflow before multiplying
                if (sfi > max_val / prime) {
                    std::cerr << "ERROR: SFI overflow detected during encoding! Key: " << key
                              << ", Value: " << attr_it->second << ", Prime: " << prime
                              << ", Current SFI: " << sfi << std::endl;
                    // Handle overflow - returning 1 signifies an error or unusable SFI
                    // Alternatively, could throw an exception if required.
                    return 1; // Indicate error/invalid SFI
                }
                sfi *= prime;
            }
        } else {
             // Optional: Add warning if an expected attribute is missing from item data
             // std::cerr << "Warning: Attribute key '" << key << "' not found in item data for SFI encoding." << std::endl;
        }
    }
    return sfi;
}

// Processes a single item's raw data to calculate its SFIs
// Note: This method isn't directly exposed to JS in this version
std::tuple<uint64_t, uint64_t> PrimeKit::process_item(const ItemData& item) {
    uint64_t master_sfi = encode_sfi(item, master_attribute_keys_, master_primes_);
    uint64_t local_sfi = encode_sfi(item, local_attribute_keys_, local_primes_);
    // If encoding failed (overflow), the SFI will be 1
    return std::make_tuple(master_sfi, local_sfi);
}

// Initializes the internal SKU list from inventory data passed from JS
void PrimeKit::initialize_data(const std::vector<SkuData>& inventory_data) {
    internal_sku_data_.clear();
    internal_sku_data_.reserve(inventory_data.size()); // Optimize allocation
    internal_sku_data_ = inventory_data; // Directly assign the vector passed from JS
    std::cout << "Initialized PrimeKit with " << internal_sku_data_.size() << " SKUs." << std::endl;
}

// Filters the loaded SKUs based on query SFIs
std::vector<std::string> PrimeKit::perform_filter(uint64_t master_query, uint64_t local_query) {
    std::vector<std::string> matching_sku_ids;
    // Query value 1 means 'match all' for that tier (wildcard)
    // Query value 0 is invalid, treat as 1 (wildcard)
    if (master_query == 0) master_query = 1;
    if (local_query == 0) local_query = 1;

    std::cout << "Filtering with Master Query: " << master_query << ", Local Query: " << local_query << std::endl;

    for (const auto& sku : internal_sku_data_) {
        // Skip SKUs that had encoding errors (SFI is 1)
        if (sku.master_sfi == 1 && master_query != 1) continue;
        if (sku.local_sfi == 1 && local_query != 1) continue;

        // The core two-tier divisibility check:
        bool master_match = (master_query == 1 || (sku.master_sfi % master_query == 0));
        bool local_match = (local_query == 1 || (sku.local_sfi % local_query == 0));

        if (master_match && local_match) {
            matching_sku_ids.push_back(sku.sku_id);
        }
    }
    std::cout << "Found " << matching_sku_ids.size() << " matching SKUs." << std::endl;
    return matching_sku_ids;
}

// --- Embind Bindings ---

using namespace emscripten;

EMSCRIPTEN_BINDINGS(primekit_module) {
    // Bind the SkuData struct as a value object (can be passed by value)
    value_object<SkuData>("SkuData")
        .field("sku_id", &SkuData::sku_id)
        .field("master_sfi", &SkuData::master_sfi)
        .field("local_sfi", &SkuData::local_sfi);

    // Register std::vector<SkuData> for passing between JS and C++
    register_vector<SkuData>("VectorSkuData");
    // Register std::vector<std::string> for returning results
    register_vector<std::string>("VectorString");

    // Bind the PrimeKit class
    class_<PrimeKit>("PrimeKit")
        .constructor<>() // Bind the default constructor
        // Allow JS to create SkuData objects needed for initialize_data
        // Note: This relies on the SkuData() and SkuData(std::string, uint64_t, uint64_t) constructors
        // It might be cleaner for JS to pass raw data and have C++ construct SkuData,
        // but passing the vector directly simplifies the C++ side as per the header change.
        .function("initializeData", &PrimeKit::initialize_data, allow_raw_pointers())
        .function("performFilter", &PrimeKit::perform_filter);

    // Note: We are not binding get_prime, encode_sfi, or process_item directly.
    // JS will need to fetch/manage its own prime mappings to create the query SFIs.
    // JS will also need to pre-process the raw inventory JSON into a structure
    // matching VectorSkuData before calling initializeData.
} 