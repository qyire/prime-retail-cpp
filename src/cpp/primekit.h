#ifndef PRIME_KIT_H
#define PRIME_KIT_H

#include <string>
#include <vector>
#include <unordered_map>
#include <cstdint>
#include <tuple>

// Type definitions
using AttributeValueMap = std::unordered_map<std::string, uint64_t>;
using PrimeDictionary = std::unordered_map<std::string, AttributeValueMap>;
using ItemAttributes = std::unordered_map<std::string, std::vector<std::string>>;

// Structure to hold internal SKU data (SKU ID and calculated SFIs)
struct SkuData {
    std::string id;
    uint64_t sfi; // Single SFI value
    // Removed master_sfi, local_sfi
};

// Structure for filter results including SFIs
struct FilterResult {
    std::string id;
    uint64_t sfi; // Single SFI value for the result
    // Removed masterSfi, localSfi
};

// The core class for SFI encoding and filtering
class PrimeKit {
public:
    PrimeKit();
    ~PrimeKit();

    // NEW: Initializes from a JSON string containing the inventory array
    void initializeFromJson(const std::string& inventoryJsonString);

    // Processes a single item's JSON representation to calculate its SFIs
    // Changed ItemData parameter to ItemAttributes
    std::tuple<uint64_t, uint64_t> process_item_attributes(const ItemAttributes& item_attributes);

    // Encodes SFI based on selected attributes and primes
    // Changed ItemData parameter to ItemAttributes
    uint64_t encode_sfi(const ItemAttributes& attributes, const std::vector<std::string>& relevant_keys, const PrimeDictionary& prime_dict);

    // Updated perform_filter to return vector<FilterResult> again
    std::vector<FilterResult> perform_filter(uint64_t query_sfi); // Single query SFI

    // New method to load primes from JSON
    void initializePrimesFromJson(const std::string& primesJsonString);

    // Static method for explicit deletion from JS
    static void delete_(PrimeKit* instance) {
        delete instance;
    }

private:
    // Helper to get prime, returns 1 if not found
    uint64_t get_prime(const PrimeDictionary& dict, const std::string& key, const std::string& value);

    // Hardcoded prime dictionaries (replace JSON loading for now)
    PrimeDictionary master_primes_;
    PrimeDictionary local_primes_; // Example: Using one local dict for simplicity
    // Define which attributes belong to master/local categories
    std::vector<std::string> master_attribute_keys_;
    std::vector<std::string> local_attribute_keys_;

    // Internal storage for processed SKU data
    std::vector<SkuData> internal_sku_data_;

    // --- New structure for combined primes ---
    std::unordered_map<std::string, std::unordered_map<std::string, uint64_t>> attribute_prime_map;
};

#endif // PRIME_KIT_H 