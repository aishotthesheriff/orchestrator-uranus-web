#!/bin/bash

# Image Provider Testing Script for Uranus Dungeon Guide
# Tests all available image model providers systematically

set -e

# Configuration
BASE_URL="http://localhost:5001"
API_KEY="${ADMIN_API_KEY:?Set ADMIN_API_KEY to one of the keys in ADMIN_API_KEYS}"
OUTPUT_DIR="./test-results/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$OUTPUT_DIR/image-provider-tests.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Logging function
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# Test result tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Test result function
test_result() {
    local test_name="$1"
    local success="$2"
    local duration="$3"
    local details="$4"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$success" = "true" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log "${GREEN}✅ PASS${NC} - $test_name (${duration}ms)"
        if [ -n "$details" ]; then
            log "   Details: $details"
        fi
    elif [ "$success" = "skipped" ]; then
        SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
        log "${YELLOW}⏭️  SKIP${NC} - $test_name"
        if [ -n "$details" ]; then
            log "   Reason: $details"
        fi
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log "${RED}❌ FAIL${NC} - $test_name (${duration}ms)"
        if [ -n "$details" ]; then
            log "   Error: $details"
        fi
    fi
}

# Test a single image provider
test_image_provider() {
    local model_key="$1"
    local provider_name="$2"
    local template_name="${3:-general_scene}"
    local test_description="$4"
    
    local test_name="Image Provider: $provider_name ($model_key)"
    local start_time=$(date +%s)
    
    log "${BLUE}Testing $test_name...${NC}"
    
    # Prepare test data
    local test_data=$(cat <<EOF
{
  "templateName": "$template_name",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior with cosmic elements",
    "imageModelKey": "$model_key"
  }
}
EOF
)
    
    # Make the API call
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/test-generate-image" \
        -H "Content-Type: application/json" \
        -d "$test_data" 2>/dev/null)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    local end_time=$(date +%s)
    local duration=$(((end_time - start_time) * 1000))
    
    # Save detailed response
    echo "$body" | jq . > "$OUTPUT_DIR/${model_key}_response.json" 2>/dev/null || echo "$body" > "$OUTPUT_DIR/${model_key}_response.txt"
    
    # Validate response
    if [ "$http_code" = "200" ]; then
        # Check if response contains imageUrl
        if echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            local image_url=$(echo "$body" | jq -r '.imageUrl')
            local prompt_used=$(echo "$body" | jq -r '.promptUsed // "N/A"')
            local debug_info=$(echo "$body" | jq -r '.debugInfo // {}')
            
            # Validate image URL format
            if [[ "$image_url" =~ ^data:image/.*base64,.* ]] || [[ "$image_url" =~ ^https?://.* ]]; then
                test_result "$test_name" "true" "$duration" "Generated image successfully"
            else
                test_result "$test_name" "false" "$duration" "Invalid image URL format: $image_url"
            fi
        else
            test_result "$test_name" "false" "$duration" "No imageUrl in response"
        fi
    else
        local error_msg=$(echo "$body" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "HTTP $http_code")
        test_result "$test_name" "false" "$duration" "$error_msg"
    fi
}

# Test error handling
test_error_handling() {
    log "${BLUE}Testing error handling...${NC}"
    
    # Test invalid model key
    local test_name="Error Handling: Invalid Model Key"
    local start_time=$(date +%s)
    
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/test-generate-image" \
        -H "Content-Type: application/json" \
        -d '{"templateName": "general_scene", "variables": {"imageModelKey": "invalid-model"}}' 2>/dev/null)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    local end_time=$(date +%s)
    local duration=$(((end_time - start_time) * 1000))
    
    if [ "$http_code" = "400" ] || [ "$http_code" = "500" ]; then
        test_result "$test_name" "true" "$duration" "Properly handled invalid model"
    else
        test_result "$test_name" "false" "$duration" "Expected error for invalid model, got HTTP $http_code"
    fi
    
    # Test missing template
    test_name="Error Handling: Missing Template"
    start_time=$(date +%s%3N)
    
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/test-generate-image" \
        -H "Content-Type: application/json" \
        -d '{"templateName": "nonexistent_template", "variables": {"imageModelKey": "gpt-image-1-mini"}}' 2>/dev/null)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    end_time=$(date +%s%3N)
    duration=$((end_time - start_time))
    
    if [ "$http_code" = "400" ] || [ "$http_code" = "500" ]; then
        test_result "$test_name" "true" "$duration" "Properly handled missing template"
    else
        test_result "$test_name" "false" "$duration" "Expected error for missing template, got HTTP $http_code"
    fi
}

# Test performance benchmarks
test_performance() {
    log "${BLUE}Testing performance benchmarks...${NC}"
    
    # Test fast model (OpenAI)
    local test_name="Performance: Fast Model (OpenAI)"
    local start_time=$(date +%s)
    
    test_image_provider "gpt-image-1-mini" "OpenAI" "general_scene" "Fast generation test"
    
    local end_time=$(date +%s)
    local duration=$(((end_time - start_time) * 1000))
    
    if [ "$duration" -lt 30000 ]; then
        test_result "$test_name" "true" "$duration" "Fast model completed in reasonable time"
    else
        test_result "$test_name" "false" "$duration" "Fast model took too long (>30s)"
    fi
}

# Check prerequisites
check_prerequisites() {
    log "${BLUE}Checking prerequisites...${NC}"
    
    # Check if server is running
    if ! curl -s "$BASE_URL/api/health" > /dev/null 2>&1; then
        log "${RED}❌ Server is not running at $BASE_URL${NC}"
        exit 1
    fi
    
    # Check if jq is available
    if ! command -v jq > /dev/null 2>&1; then
        log "${RED}❌ jq is required but not installed${NC}"
        exit 1
    fi
    
    # Check environment variables
    if [ -z "$OPENAI_API_KEY" ]; then
        log "${YELLOW}⚠️  OPENAI_API_KEY not set - OpenAI tests will be skipped${NC}"
    fi
    
    if [ -z "$HF_TOKEN" ]; then
        log "${YELLOW}⚠️  HF_TOKEN not set - HuggingFace tests will be skipped${NC}"
    fi
    
    log "${GREEN}✅ Prerequisites check completed${NC}"
}

# Main test execution
main() {
    log "${GREEN}🧪 Image Provider Testing Suite${NC}"
    log "=================================="
    log "Testing all available image model providers"
    log "Output directory: $OUTPUT_DIR"
    log "Log file: $LOG_FILE"
    log ""
    
    check_prerequisites
    
    log "${BLUE}Starting image provider tests...${NC}"
    log ""
    
    # Test OpenAI provider
    if [ -n "$OPENAI_API_KEY" ]; then
        log "${YELLOW}Testing OpenAI Provider${NC}"
        test_image_provider "gpt-image-1-mini" "OpenAI" "general_scene" "OpenAI GPT Image 1 Mini"
    else
        test_result "OpenAI Provider" "skipped" "0" "OPENAI_API_KEY not set"
    fi
    
    # Test HuggingFace providers
    if [ -n "$HF_TOKEN" ]; then
        log "${YELLOW}Testing HuggingFace Providers${NC}"
        
        # Standard SDXL models
        test_image_provider "sdxl-turbo" "HuggingFace SDXL Turbo" "general_scene" "SDXL Turbo (Fast)"
        
        # FLUX models
        test_image_provider "flux-schnell" "HuggingFace FLUX" "general_scene" "FLUX.1 Schnell (Ultra Fast)"
        
        # SD 3.5 models
        test_image_provider "sd-large-turbo" "HuggingFace SD 3.5 Large" "general_scene" "Stable Diffusion 3.5 Large Turbo"
        test_image_provider "sd-medium-turbo" "HuggingFace SD 3.5 Medium" "general_scene" "Stable Diffusion 3.5 Medium"
        
        # Specialized style models
        test_image_provider "claymation-xl" "HuggingFace Claymation" "general_scene" "Claymation Style SDXL"
        test_image_provider "retro-pixel-flux" "HuggingFace Retro Pixel" "general_scene" "Retro Pixel Art FLUX"
        test_image_provider "fal-flux-pixel-art" "HuggingFace Modern Pixel" "general_scene" "Modern Pixel Art FLUX"
    else
        log "${YELLOW}Skipping HuggingFace tests - HF_TOKEN not set${NC}"
        test_result "HuggingFace Providers" "skipped" "0" "HF_TOKEN not set"
    fi
    
    # Test error handling
    log "${YELLOW}Testing Error Handling${NC}"
    test_error_handling
    
    # Test performance
    log "${YELLOW}Testing Performance${NC}"
    test_performance
    
    # Generate summary report
    log ""
    log "${GREEN}📊 Test Summary${NC}"
    log "==============="
    log "Total Tests: $TOTAL_TESTS"
    log "Passed: $PASSED_TESTS"
    log "Failed: $FAILED_TESTS"
    log "Skipped: $SKIPPED_TESTS"
    log ""
    
    if [ "$FAILED_TESTS" -eq 0 ]; then
        log "${GREEN}🎉 All tests passed!${NC}"
        exit 0
    else
        log "${RED}❌ $FAILED_TESTS test(s) failed${NC}"
        exit 1
    fi
}

# Run the tests
main "$@"
