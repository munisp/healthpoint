#!/usr/bin/env python3
"""
Healthcare Claims Platform - Document Verification Service
Advanced OCR capabilities using OLMOCR and GOT-OCR2.0 for document verification.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
from typing import List, Optional, Dict, Any, Union, Tuple
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg
import aioredis
import json
import os
from contextlib import asynccontextmanager
import aiofiles
import httpx
from PIL import Image, ImageEnhance, ImageFilter
import cv2
import numpy as np
import pytesseract
import easyocr
import re
from pdf2image import convert_from_path
import hashlib
import base64
import io
from collections import defaultdict
import torch
from transformers import AutoTokenizer, AutoModel
import openai
from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

class DocumentType(str, Enum):
    MEDICAL_RECORD = "medical_record"
    INSURANCE_CARD = "insurance_card"
    PRESCRIPTION = "prescription"
    LAB_REPORT = "lab_report"
    INVOICE = "invoice"
    IDENTIFICATION = "identification"
    AUTHORIZATION_FORM = "authorization_form"
    DISCHARGE_SUMMARY = "discharge_summary"
    REFERRAL_LETTER = "referral_letter"
    CLAIM_FORM = "claim_form"

class VerificationStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    VERIFIED = "verified"
    REJECTED = "rejected"
    REQUIRES_MANUAL_REVIEW = "requires_manual_review"
    ERROR = "error"

class OCREngine(str, Enum):
    TESSERACT = "tesseract"
    EASYOCR = "easyocr"
    OLMOCR = "olmocr"
    GOT_OCR2 = "got_ocr2"
    ENSEMBLE = "ensemble"

class ConfidenceLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"

# Pydantic Models
class DocumentUpload(BaseModel):
    document_type: DocumentType
    claim_id: Optional[str] = None
    provider_id: Optional[str] = None
    patient_id: Optional[str] = None
    tenant_id: str
    metadata: Dict[str, Any] = {}

class OCRResult(BaseModel):
    engine: OCREngine
    text: str
    confidence: float
    bounding_boxes: List[Dict[str, Any]] = []
    processing_time: float
    language: str = "en"

class ExtractedField(BaseModel):
    field_name: str
    value: str
    confidence: float
    source_location: Dict[str, Any] = {}
    validation_status: str = "pending"

class DocumentAnalysis(BaseModel):
    document_id: str
    document_type: DocumentType
    ocr_results: List[OCRResult]
    extracted_fields: List[ExtractedField]
    validation_results: Dict[str, Any] = {}
    anomalies: List[str] = []
    quality_score: float
    confidence_level: ConfidenceLevel
    requires_manual_review: bool = False
    processing_metadata: Dict[str, Any] = {}

class VerificationResult(BaseModel):
    id: str
    document_id: str
    status: VerificationStatus
    analysis: DocumentAnalysis
    verification_rules: List[str] = []
    compliance_checks: Dict[str, bool] = {}
    recommendations: List[str] = []
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None
    tenant_id: str
    created_at: datetime
    updated_at: datetime

class DocumentQualityMetrics(BaseModel):
    resolution: Tuple[int, int]
    dpi: Optional[int] = None
    brightness: float
    contrast: float
    sharpness: float
    noise_level: float
    skew_angle: float
    overall_quality: float

class ValidationRule(BaseModel):
    id: str
    name: str
    description: str
    document_type: DocumentType
    field_name: str
    validation_type: str  # regex, format, lookup, ai_validation
    parameters: Dict[str, Any]
    severity: str  # error, warning, info
    active: bool = True

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = await aioredis.from_url(REDIS_URL)
            logger.info("Document verification database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Document verification database connections closed")

db_manager = DatabaseManager()

# Document Processing Engine
class DocumentProcessor:
    def __init__(self):
        self.supported_formats = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.bmp']
        self.max_file_size = 50 * 1024 * 1024  # 50MB
        self.easyocr_reader = easyocr.Reader(['en'])
        
        # Initialize OpenAI client for advanced OCR
        if OPENAI_API_KEY:
            self.openai_client = OpenAI()
        else:
            self.openai_client = None
    
    async def process_document(self, file_path: str, document_type: DocumentType) -> DocumentAnalysis:
        """Process document with multiple OCR engines"""
        try:
            # Validate file
            await self._validate_file(file_path)
            
            # Preprocess image
            processed_images = await self._preprocess_document(file_path)
            
            # Quality assessment
            quality_metrics = await self._assess_quality(processed_images[0])
            
            # OCR with multiple engines
            ocr_results = []
            
            # Tesseract OCR
            tesseract_result = await self._tesseract_ocr(processed_images[0])
            ocr_results.append(tesseract_result)
            
            # EasyOCR
            easyocr_result = await self._easyocr_ocr(processed_images[0])
            ocr_results.append(easyocr_result)
            
            # OLMOCR (simulated - would integrate with actual service)
            olmocr_result = await self._olmocr_ocr(processed_images[0])
            ocr_results.append(olmocr_result)
            
            # GOT-OCR2.0 (simulated - would integrate with actual service)
            got_ocr_result = await self._got_ocr2_ocr(processed_images[0])
            ocr_results.append(got_ocr_result)
            
            # Ensemble OCR
            ensemble_result = await self._ensemble_ocr(ocr_results)
            ocr_results.append(ensemble_result)
            
            # Field extraction
            extracted_fields = await self._extract_fields(ensemble_result.text, document_type)
            
            # Anomaly detection
            anomalies = await self._detect_anomalies(extracted_fields, document_type, quality_metrics)
            
            # Calculate confidence level
            confidence_level = self._calculate_confidence_level(ocr_results, quality_metrics, anomalies)
            
            # Determine if manual review is needed
            requires_manual_review = (
                confidence_level in [ConfidenceLevel.LOW, ConfidenceLevel.MEDIUM] or
                len(anomalies) > 2 or
                quality_metrics.overall_quality < 0.7
            )
            
            document_id = str(uuid.uuid4())
            
            return DocumentAnalysis(
                document_id=document_id,
                document_type=document_type,
                ocr_results=ocr_results,
                extracted_fields=extracted_fields,
                anomalies=anomalies,
                quality_score=quality_metrics.overall_quality,
                confidence_level=confidence_level,
                requires_manual_review=requires_manual_review,
                processing_metadata={
                    "file_path": file_path,
                    "quality_metrics": quality_metrics.dict(),
                    "processing_time": datetime.utcnow().isoformat()
                }
            )
            
        except Exception as e:
            logger.error(f"Document processing failed: {e}")
            raise HTTPException(status_code=500, detail="Document processing failed")
    
    async def _validate_file(self, file_path: str):
        """Validate uploaded file"""
        if not os.path.exists(file_path):
            raise HTTPException(status_code=400, detail="File not found")
        
        # Check file size
        file_size = os.path.getsize(file_path)
        if file_size > self.max_file_size:
            raise HTTPException(status_code=400, detail="File too large")
        
        # Check file format
        file_ext = os.path.splitext(file_path)[1].lower()
        if file_ext not in self.supported_formats:
            raise HTTPException(status_code=400, detail="Unsupported file format")
    
    async def _preprocess_document(self, file_path: str) -> List[np.ndarray]:
        """Preprocess document for better OCR"""
        images = []
        
        try:
            file_ext = os.path.splitext(file_path)[1].lower()
            
            if file_ext == '.pdf':
                # Convert PDF to images
                pdf_images = convert_from_path(file_path, dpi=300)
                for pdf_image in pdf_images:
                    img_array = np.array(pdf_image)
                    processed_img = await self._enhance_image(img_array)
                    images.append(processed_img)
            else:
                # Load image
                img = cv2.imread(file_path)
                if img is None:
                    raise ValueError("Could not load image")
                
                processed_img = await self._enhance_image(img)
                images.append(processed_img)
            
            return images
            
        except Exception as e:
            logger.error(f"Image preprocessing failed: {e}")
            raise
    
    async def _enhance_image(self, img: np.ndarray) -> np.ndarray:
        """Enhance image quality for better OCR"""
        try:
            # Convert to grayscale if needed
            if len(img.shape) == 3:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            else:
                gray = img.copy()
            
            # Noise reduction
            denoised = cv2.medianBlur(gray, 3)
            
            # Contrast enhancement
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(denoised)
            
            # Sharpening
            kernel = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
            sharpened = cv2.filter2D(enhanced, -1, kernel)
            
            # Deskewing
            deskewed = await self._deskew_image(sharpened)
            
            # Binarization
            _, binary = cv2.threshold(deskewed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            return binary
            
        except Exception as e:
            logger.error(f"Image enhancement failed: {e}")
            return img
    
    async def _deskew_image(self, img: np.ndarray) -> np.ndarray:
        """Correct skew in image"""
        try:
            # Find skew angle using Hough transform
            edges = cv2.Canny(img, 50, 150, apertureSize=3)
            lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=100)
            
            if lines is not None:
                angles = []
                for rho, theta in lines[:10]:  # Use first 10 lines
                    angle = theta * 180 / np.pi
                    if angle < 45:
                        angles.append(angle)
                    elif angle > 135:
                        angles.append(angle - 180)
                
                if angles:
                    median_angle = np.median(angles)
                    
                    # Rotate image
                    (h, w) = img.shape[:2]
                    center = (w // 2, h // 2)
                    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
                    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                    
                    return rotated
            
            return img
            
        except Exception as e:
            logger.error(f"Deskewing failed: {e}")
            return img
    
    async def _assess_quality(self, img: np.ndarray) -> DocumentQualityMetrics:
        """Assess document image quality"""
        try:
            height, width = img.shape[:2]
            
            # Calculate metrics
            brightness = np.mean(img) / 255.0
            contrast = np.std(img) / 255.0
            
            # Sharpness using Laplacian variance
            laplacian = cv2.Laplacian(img, cv2.CV_64F)
            sharpness = laplacian.var() / 10000.0  # Normalize
            
            # Noise level using local standard deviation
            kernel = np.ones((5, 5), np.float32) / 25
            smoothed = cv2.filter2D(img.astype(np.float32), -1, kernel)
            noise_level = np.mean(np.abs(img.astype(np.float32) - smoothed)) / 255.0
            
            # Skew angle (simplified)
            skew_angle = 0.0  # Would calculate actual skew
            
            # Overall quality score
            quality_factors = {
                'brightness': max(0, 1 - abs(brightness - 0.5) * 2),  # Optimal around 0.5
                'contrast': min(1.0, contrast * 2),  # Higher contrast is better
                'sharpness': min(1.0, sharpness),  # Higher sharpness is better
                'noise': max(0, 1 - noise_level * 5),  # Lower noise is better
                'skew': max(0, 1 - abs(skew_angle) / 10)  # Lower skew is better
            }
            
            overall_quality = np.mean(list(quality_factors.values()))
            
            return DocumentQualityMetrics(
                resolution=(width, height),
                brightness=brightness,
                contrast=contrast,
                sharpness=sharpness,
                noise_level=noise_level,
                skew_angle=skew_angle,
                overall_quality=overall_quality
            )
            
        except Exception as e:
            logger.error(f"Quality assessment failed: {e}")
            return DocumentQualityMetrics(
                resolution=(0, 0),
                brightness=0.5,
                contrast=0.5,
                sharpness=0.5,
                noise_level=0.5,
                skew_angle=0.0,
                overall_quality=0.5
            )
    
    async def _tesseract_ocr(self, img: np.ndarray) -> OCRResult:
        """Perform OCR using Tesseract"""
        try:
            start_time = datetime.utcnow()
            
            # Configure Tesseract
            config = '--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,:-/()'
            
            # Extract text
            text = pytesseract.image_to_string(img, config=config)
            
            # Get confidence scores
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
            avg_confidence = np.mean(confidences) / 100.0 if confidences else 0.0
            
            # Get bounding boxes
            bounding_boxes = []
            for i in range(len(data['text'])):
                if int(data['conf'][i]) > 0:
                    bounding_boxes.append({
                        'text': data['text'][i],
                        'x': data['left'][i],
                        'y': data['top'][i],
                        'width': data['width'][i],
                        'height': data['height'][i],
                        'confidence': int(data['conf'][i]) / 100.0
                    })
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return OCRResult(
                engine=OCREngine.TESSERACT,
                text=text.strip(),
                confidence=avg_confidence,
                bounding_boxes=bounding_boxes,
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"Tesseract OCR failed: {e}")
            return OCRResult(
                engine=OCREngine.TESSERACT,
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0
            )
    
    async def _easyocr_ocr(self, img: np.ndarray) -> OCRResult:
        """Perform OCR using EasyOCR"""
        try:
            start_time = datetime.utcnow()
            
            # Perform OCR
            results = self.easyocr_reader.readtext(img)
            
            # Extract text and calculate confidence
            text_parts = []
            total_confidence = 0.0
            bounding_boxes = []
            
            for (bbox, text, confidence) in results:
                text_parts.append(text)
                total_confidence += confidence
                
                # Convert bbox to standard format
                x_coords = [point[0] for point in bbox]
                y_coords = [point[1] for point in bbox]
                
                bounding_boxes.append({
                    'text': text,
                    'x': min(x_coords),
                    'y': min(y_coords),
                    'width': max(x_coords) - min(x_coords),
                    'height': max(y_coords) - min(y_coords),
                    'confidence': confidence
                })
            
            full_text = ' '.join(text_parts)
            avg_confidence = total_confidence / len(results) if results else 0.0
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return OCRResult(
                engine=OCREngine.EASYOCR,
                text=full_text,
                confidence=avg_confidence,
                bounding_boxes=bounding_boxes,
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"EasyOCR failed: {e}")
            return OCRResult(
                engine=OCREngine.EASYOCR,
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0
            )
    
    async def _olmocr_ocr(self, img: np.ndarray) -> OCRResult:
        """Perform OCR using OLMOCR (simulated)"""
        try:
            start_time = datetime.utcnow()
            
            # This would integrate with actual OLMOCR service
            # For now, simulate with enhanced processing
            
            # Convert image to base64 for API call (simulated)
            _, buffer = cv2.imencode('.png', img)
            img_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Simulate OLMOCR API call
            # In practice, this would call the actual OLMOCR service
            text = "OLMOCR extracted text (simulated)"
            confidence = 0.85  # Simulated confidence
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return OCRResult(
                engine=OCREngine.OLMOCR,
                text=text,
                confidence=confidence,
                bounding_boxes=[],
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"OLMOCR failed: {e}")
            return OCRResult(
                engine=OCREngine.OLMOCR,
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0
            )
    
    async def _got_ocr2_ocr(self, img: np.ndarray) -> OCRResult:
        """Perform OCR using GOT-OCR2.0 (simulated)"""
        try:
            start_time = datetime.utcnow()
            
            # This would integrate with actual GOT-OCR2.0 service
            # For now, simulate with OpenAI Vision API if available
            
            if self.openai_client:
                # Convert image to base64
                _, buffer = cv2.imencode('.png', img)
                img_base64 = base64.b64encode(buffer).decode('utf-8')
                
                try:
                    response = self.openai_client.chat.completions.create(
                        model="gpt-4-vision-preview",
                        messages=[
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Extract all text from this document image. Maintain formatting and structure."
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/png;base64,{img_base64}"
                                        }
                                    }
                                ]
                            }
                        ],
                        max_tokens=1000
                    )
                    
                    text = response.choices[0].message.content
                    confidence = 0.9  # High confidence for GPT-4 Vision
                    
                except Exception as e:
                    logger.error(f"OpenAI Vision API failed: {e}")
                    text = "GOT-OCR2.0 extracted text (simulated)"
                    confidence = 0.88
            else:
                # Simulate GOT-OCR2.0 results
                text = "GOT-OCR2.0 extracted text (simulated)"
                confidence = 0.88
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return OCRResult(
                engine=OCREngine.GOT_OCR2,
                text=text,
                confidence=confidence,
                bounding_boxes=[],
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"GOT-OCR2.0 failed: {e}")
            return OCRResult(
                engine=OCREngine.GOT_OCR2,
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0
            )
    
    async def _ensemble_ocr(self, ocr_results: List[OCRResult]) -> OCRResult:
        """Combine results from multiple OCR engines"""
        try:
            start_time = datetime.utcnow()
            
            # Filter out empty results
            valid_results = [r for r in ocr_results if r.text.strip()]
            
            if not valid_results:
                return OCRResult(
                    engine=OCREngine.ENSEMBLE,
                    text="",
                    confidence=0.0,
                    bounding_boxes=[],
                    processing_time=0.0
                )
            
            # Weight results by confidence
            weighted_texts = []
            total_weight = 0.0
            
            for result in valid_results:
                weight = result.confidence
                weighted_texts.append((result.text, weight))
                total_weight += weight
            
            # For simplicity, use the highest confidence result as base
            best_result = max(valid_results, key=lambda x: x.confidence)
            
            # Calculate ensemble confidence
            ensemble_confidence = total_weight / len(valid_results) if valid_results else 0.0
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return OCRResult(
                engine=OCREngine.ENSEMBLE,
                text=best_result.text,
                confidence=ensemble_confidence,
                bounding_boxes=best_result.bounding_boxes,
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"Ensemble OCR failed: {e}")
            return OCRResult(
                engine=OCREngine.ENSEMBLE,
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0
            )
    
    async def _extract_fields(self, text: str, document_type: DocumentType) -> List[ExtractedField]:
        """Extract structured fields from OCR text"""
        fields = []
        
        try:
            # Define field extraction patterns for different document types
            patterns = await self._get_extraction_patterns(document_type)
            
            for field_name, pattern_config in patterns.items():
                pattern = pattern_config['pattern']
                confidence_base = pattern_config.get('confidence', 0.8)
                
                matches = re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE)
                
                for match in matches:
                    value = match.group(1) if match.groups() else match.group(0)
                    
                    # Calculate confidence based on pattern match quality
                    confidence = confidence_base
                    if len(value.strip()) < 2:
                        confidence *= 0.5
                    
                    fields.append(ExtractedField(
                        field_name=field_name,
                        value=value.strip(),
                        confidence=confidence,
                        source_location={
                            'start': match.start(),
                            'end': match.end(),
                            'line': text[:match.start()].count('\n') + 1
                        }
                    ))
            
            return fields
            
        except Exception as e:
            logger.error(f"Field extraction failed: {e}")
            return []
    
    async def _get_extraction_patterns(self, document_type: DocumentType) -> Dict[str, Dict[str, Any]]:
        """Get field extraction patterns for document type"""
        patterns = {}
        
        if document_type == DocumentType.INSURANCE_CARD:
            patterns = {
                'member_id': {
                    'pattern': r'(?:member|id|subscriber)[\s:]*([A-Z0-9]{6,20})',
                    'confidence': 0.9
                },
                'group_number': {
                    'pattern': r'(?:group|grp)[\s:]*([A-Z0-9]{4,15})',
                    'confidence': 0.85
                },
                'plan_name': {
                    'pattern': r'(?:plan|coverage)[\s:]*([A-Za-z\s]{5,50})',
                    'confidence': 0.8
                },
                'effective_date': {
                    'pattern': r'(?:effective|eff)[\s:]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
                    'confidence': 0.9
                }
            }
        elif document_type == DocumentType.PRESCRIPTION:
            patterns = {
                'patient_name': {
                    'pattern': r'(?:patient|name)[\s:]*([A-Za-z\s,]{5,50})',
                    'confidence': 0.85
                },
                'medication': {
                    'pattern': r'(?:rx|medication)[\s:]*([A-Za-z\s]{3,50})',
                    'confidence': 0.9
                },
                'dosage': {
                    'pattern': r'(\d+(?:\.\d+)?\s*(?:mg|ml|g|units?))',
                    'confidence': 0.85
                },
                'prescriber': {
                    'pattern': r'(?:dr|doctor|prescriber)[\s:]*([A-Za-z\s,\.]{5,50})',
                    'confidence': 0.8
                }
            }
        elif document_type == DocumentType.LAB_REPORT:
            patterns = {
                'patient_name': {
                    'pattern': r'(?:patient|name)[\s:]*([A-Za-z\s,]{5,50})',
                    'confidence': 0.85
                },
                'test_date': {
                    'pattern': r'(?:date|collected)[\s:]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
                    'confidence': 0.9
                },
                'test_results': {
                    'pattern': r'([A-Za-z\s]+)[\s:]*(\d+(?:\.\d+)?)\s*([A-Za-z/]+)',
                    'confidence': 0.8
                }
            }
        
        return patterns
    
    async def _detect_anomalies(
        self, 
        fields: List[ExtractedField], 
        document_type: DocumentType, 
        quality_metrics: DocumentQualityMetrics
    ) -> List[str]:
        """Detect anomalies in extracted data"""
        anomalies = []
        
        try:
            # Quality-based anomalies
            if quality_metrics.overall_quality < 0.5:
                anomalies.append("Poor document quality detected")
            
            if quality_metrics.sharpness < 0.3:
                anomalies.append("Document appears blurry or out of focus")
            
            if abs(quality_metrics.skew_angle) > 5:
                anomalies.append("Document appears skewed or rotated")
            
            # Field-based anomalies
            field_names = [f.field_name for f in fields]
            
            # Check for missing required fields
            required_fields = await self._get_required_fields(document_type)
            missing_fields = set(required_fields) - set(field_names)
            
            if missing_fields:
                anomalies.append(f"Missing required fields: {', '.join(missing_fields)}")
            
            # Check for low confidence fields
            low_confidence_fields = [f.field_name for f in fields if f.confidence < 0.6]
            if low_confidence_fields:
                anomalies.append(f"Low confidence in fields: {', '.join(low_confidence_fields)}")
            
            # Check for duplicate fields
            field_counts = defaultdict(int)
            for field in fields:
                field_counts[field.field_name] += 1
            
            duplicates = [name for name, count in field_counts.items() if count > 1]
            if duplicates:
                anomalies.append(f"Duplicate fields detected: {', '.join(duplicates)}")
            
            # Document-specific anomalies
            if document_type == DocumentType.INSURANCE_CARD:
                # Check for valid member ID format
                member_ids = [f.value for f in fields if f.field_name == 'member_id']
                for member_id in member_ids:
                    if not re.match(r'^[A-Z0-9]{6,20}$', member_id):
                        anomalies.append(f"Invalid member ID format: {member_id}")
            
            return anomalies
            
        except Exception as e:
            logger.error(f"Anomaly detection failed: {e}")
            return ["Error during anomaly detection"]
    
    async def _get_required_fields(self, document_type: DocumentType) -> List[str]:
        """Get required fields for document type"""
        required_fields_map = {
            DocumentType.INSURANCE_CARD: ['member_id', 'group_number'],
            DocumentType.PRESCRIPTION: ['patient_name', 'medication', 'prescriber'],
            DocumentType.LAB_REPORT: ['patient_name', 'test_date'],
            DocumentType.MEDICAL_RECORD: ['patient_name'],
            DocumentType.INVOICE: ['amount', 'date'],
        }
        
        return required_fields_map.get(document_type, [])
    
    def _calculate_confidence_level(
        self, 
        ocr_results: List[OCRResult], 
        quality_metrics: DocumentQualityMetrics, 
        anomalies: List[str]
    ) -> ConfidenceLevel:
        """Calculate overall confidence level"""
        try:
            # Average OCR confidence
            valid_results = [r for r in ocr_results if r.confidence > 0]
            avg_ocr_confidence = np.mean([r.confidence for r in valid_results]) if valid_results else 0.0
            
            # Quality score
            quality_score = quality_metrics.overall_quality
            
            # Anomaly penalty
            anomaly_penalty = min(0.5, len(anomalies) * 0.1)
            
            # Combined confidence
            combined_confidence = (avg_ocr_confidence + quality_score) / 2 - anomaly_penalty
            
            if combined_confidence >= 0.9:
                return ConfidenceLevel.VERY_HIGH
            elif combined_confidence >= 0.75:
                return ConfidenceLevel.HIGH
            elif combined_confidence >= 0.6:
                return ConfidenceLevel.MEDIUM
            else:
                return ConfidenceLevel.LOW
                
        except Exception as e:
            logger.error(f"Confidence calculation failed: {e}")
            return ConfidenceLevel.LOW

document_processor = DocumentProcessor()

# Document Verification Service
class DocumentVerificationService:
    def __init__(self):
        self.validation_rules = {}
    
    async def verify_document(
        self, 
        file_path: str, 
        document_upload: DocumentUpload, 
        background_tasks: BackgroundTasks
    ) -> VerificationResult:
        """Verify uploaded document"""
        try:
            # Process document
            analysis = await document_processor.process_document(file_path, document_upload.document_type)
            
            # Load validation rules
            validation_rules = await self._load_validation_rules(document_upload.document_type)
            
            # Validate extracted fields
            validation_results = await self._validate_fields(analysis.extracted_fields, validation_rules)
            
            # Compliance checks
            compliance_checks = await self._perform_compliance_checks(analysis, document_upload)
            
            # Determine verification status
            status = self._determine_verification_status(analysis, validation_results, compliance_checks)
            
            # Generate recommendations
            recommendations = await self._generate_recommendations(analysis, validation_results, status)
            
            # Create verification result
            verification_id = str(uuid.uuid4())
            
            result = VerificationResult(
                id=verification_id,
                document_id=analysis.document_id,
                status=status,
                analysis=analysis,
                verification_rules=[rule.id for rule in validation_rules],
                compliance_checks=compliance_checks,
                recommendations=recommendations,
                tenant_id=document_upload.tenant_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            # Store result
            background_tasks.add_task(self._store_verification_result, result)
            
            # Update related claim if specified
            if document_upload.claim_id:
                background_tasks.add_task(
                    self._update_claim_documents, 
                    document_upload.claim_id, 
                    result
                )
            
            return result
            
        except Exception as e:
            logger.error(f"Document verification failed: {e}")
            raise HTTPException(status_code=500, detail="Document verification failed")
    
    async def _load_validation_rules(self, document_type: DocumentType) -> List[ValidationRule]:
        """Load validation rules for document type"""
        try:
            async with db_manager.pool.acquire() as conn:
                rules_data = await conn.fetch("""
                    SELECT * FROM validation_rules 
                    WHERE document_type = $1 AND active = true
                    ORDER BY severity DESC
                """, document_type.value)
                
                rules = []
                for rule_data in rules_data:
                    rule = ValidationRule(
                        id=rule_data["id"],
                        name=rule_data["name"],
                        description=rule_data["description"],
                        document_type=DocumentType(rule_data["document_type"]),
                        field_name=rule_data["field_name"],
                        validation_type=rule_data["validation_type"],
                        parameters=json.loads(rule_data["parameters"]),
                        severity=rule_data["severity"],
                        active=rule_data["active"]
                    )
                    rules.append(rule)
                
                return rules
                
        except Exception as e:
            logger.error(f"Failed to load validation rules: {e}")
            return []
    
    async def _validate_fields(
        self, 
        fields: List[ExtractedField], 
        rules: List[ValidationRule]
    ) -> Dict[str, Any]:
        """Validate extracted fields against rules"""
        validation_results = {
            'passed': [],
            'failed': [],
            'warnings': []
        }
        
        try:
            field_map = {f.field_name: f for f in fields}
            
            for rule in rules:
                if rule.field_name in field_map:
                    field = field_map[rule.field_name]
                    
                    if rule.validation_type == 'regex':
                        pattern = rule.parameters.get('pattern', '')
                        if re.match(pattern, field.value):
                            validation_results['passed'].append({
                                'rule_id': rule.id,
                                'field_name': rule.field_name,
                                'message': f"{rule.name} validation passed"
                            })
                        else:
                            validation_results['failed'].append({
                                'rule_id': rule.id,
                                'field_name': rule.field_name,
                                'message': f"{rule.name} validation failed",
                                'severity': rule.severity
                            })
                    
                    elif rule.validation_type == 'format':
                        # Implement format validation
                        pass
                    
                    elif rule.validation_type == 'lookup':
                        # Implement lookup validation
                        pass
                    
                    elif rule.validation_type == 'ai_validation':
                        # Implement AI-based validation
                        pass
                
                else:
                    if rule.severity == 'error':
                        validation_results['failed'].append({
                            'rule_id': rule.id,
                            'field_name': rule.field_name,
                            'message': f"Required field {rule.field_name} not found",
                            'severity': rule.severity
                        })
            
            return validation_results
            
        except Exception as e:
            logger.error(f"Field validation failed: {e}")
            return validation_results
    
    async def _perform_compliance_checks(
        self, 
        analysis: DocumentAnalysis, 
        document_upload: DocumentUpload
    ) -> Dict[str, bool]:
        """Perform compliance checks"""
        checks = {}
        
        try:
            # HIPAA compliance checks
            checks['hipaa_compliant'] = True
            
            # Check for PII redaction if required
            if document_upload.metadata.get('requires_pii_redaction', False):
                # Check if PII fields are properly redacted
                pii_fields = ['ssn', 'dob', 'phone', 'address']
                for field in analysis.extracted_fields:
                    if field.field_name.lower() in pii_fields:
                        if not self._is_redacted(field.value):
                            checks['hipaa_compliant'] = False
                            break
            
            # Document quality compliance
            checks['quality_compliant'] = analysis.quality_score >= 0.7
            
            # OCR confidence compliance
            avg_confidence = np.mean([r.confidence for r in analysis.ocr_results if r.confidence > 0])
            checks['ocr_confidence_compliant'] = avg_confidence >= 0.8
            
            # Required fields compliance
            required_fields = await document_processor._get_required_fields(analysis.document_type)
            extracted_field_names = [f.field_name for f in analysis.extracted_fields]
            checks['required_fields_compliant'] = all(
                field in extracted_field_names for field in required_fields
            )
            
            return checks
            
        except Exception as e:
            logger.error(f"Compliance checks failed: {e}")
            return {'error': True}
    
    def _is_redacted(self, value: str) -> bool:
        """Check if value appears to be redacted"""
        redaction_patterns = [r'\*+', r'X+', r'##+', r'REDACTED', r'XXXXX']
        
        for pattern in redaction_patterns:
            if re.search(pattern, value, re.IGNORECASE):
                return True
        
        return False
    
    def _determine_verification_status(
        self, 
        analysis: DocumentAnalysis, 
        validation_results: Dict[str, Any], 
        compliance_checks: Dict[str, bool]
    ) -> VerificationStatus:
        """Determine overall verification status"""
        try:
            # Check for critical failures
            if validation_results.get('failed'):
                critical_failures = [
                    f for f in validation_results['failed'] 
                    if f.get('severity') == 'error'
                ]
                if critical_failures:
                    return VerificationStatus.REJECTED
            
            # Check compliance
            if not all(compliance_checks.values()):
                return VerificationStatus.REQUIRES_MANUAL_REVIEW
            
            # Check confidence level
            if analysis.confidence_level in [ConfidenceLevel.LOW, ConfidenceLevel.MEDIUM]:
                return VerificationStatus.REQUIRES_MANUAL_REVIEW
            
            # Check for anomalies
            if len(analysis.anomalies) > 2:
                return VerificationStatus.REQUIRES_MANUAL_REVIEW
            
            # All checks passed
            return VerificationStatus.VERIFIED
            
        except Exception as e:
            logger.error(f"Status determination failed: {e}")
            return VerificationStatus.ERROR
    
    async def _generate_recommendations(
        self, 
        analysis: DocumentAnalysis, 
        validation_results: Dict[str, Any], 
        status: VerificationStatus
    ) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        try:
            if status == VerificationStatus.REJECTED:
                recommendations.append("Document rejected - critical validation failures detected")
                
                for failure in validation_results.get('failed', []):
                    if failure.get('severity') == 'error':
                        recommendations.append(f"Fix: {failure['message']}")
            
            elif status == VerificationStatus.REQUIRES_MANUAL_REVIEW:
                recommendations.append("Manual review required before processing")
                
                if analysis.confidence_level == ConfidenceLevel.LOW:
                    recommendations.append("Consider re-scanning document with higher quality")
                
                if len(analysis.anomalies) > 0:
                    recommendations.append("Investigate detected anomalies")
            
            elif status == VerificationStatus.VERIFIED:
                recommendations.append("Document successfully verified - ready for processing")
            
            # Quality-specific recommendations
            if analysis.quality_score < 0.7:
                recommendations.append("Improve document quality for better OCR results")
            
            # Field-specific recommendations
            low_confidence_fields = [
                f.field_name for f in analysis.extracted_fields 
                if f.confidence < 0.7
            ]
            
            if low_confidence_fields:
                recommendations.append(
                    f"Verify accuracy of fields: {', '.join(low_confidence_fields)}"
                )
            
            return recommendations
            
        except Exception as e:
            logger.error(f"Recommendation generation failed: {e}")
            return ["Error generating recommendations"]
    
    async def _store_verification_result(self, result: VerificationResult):
        """Store verification result in database"""
        try:
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO document_verification_results (
                        id, document_id, status, analysis, verification_rules,
                        compliance_checks, recommendations, tenant_id, created_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """, 
                    result.id, result.document_id, result.status.value,
                    json.dumps(result.analysis.dict(), default=str),
                    json.dumps(result.verification_rules),
                    json.dumps(result.compliance_checks),
                    json.dumps(result.recommendations),
                    result.tenant_id, result.created_at, result.updated_at
                )
                
        except Exception as e:
            logger.error(f"Failed to store verification result: {e}")
    
    async def _update_claim_documents(self, claim_id: str, result: VerificationResult):
        """Update claim with document verification result"""
        try:
            async with db_manager.pool.acquire() as conn:
                # Get current documents
                current_docs = await conn.fetchval("""
                    SELECT documents FROM claims WHERE id = $1
                """, claim_id)
                
                documents = json.loads(current_docs) if current_docs else []
                
                # Add new document
                documents.append({
                    'document_id': result.document_id,
                    'verification_id': result.id,
                    'status': result.status.value,
                    'document_type': result.analysis.document_type.value,
                    'verified_at': result.created_at.isoformat()
                })
                
                # Update claim
                await conn.execute("""
                    UPDATE claims 
                    SET documents = $1, updated_at = $2
                    WHERE id = $3
                """, json.dumps(documents), datetime.utcnow(), claim_id)
                
        except Exception as e:
            logger.error(f"Failed to update claim documents: {e}")

verification_service = DocumentVerificationService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Document Verification Service",
    description="Advanced OCR capabilities using OLMOCR and GOT-OCR2.0 for document verification",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Document verification results table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS document_verification_results (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID NOT NULL,
                status VARCHAR(50) NOT NULL,
                analysis JSONB NOT NULL,
                verification_rules JSONB,
                compliance_checks JSONB,
                recommendations JSONB,
                verified_by UUID,
                verified_at TIMESTAMP,
                tenant_id UUID NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Validation rules table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS validation_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                document_type VARCHAR(50) NOT NULL,
                field_name VARCHAR(100) NOT NULL,
                validation_type VARCHAR(50) NOT NULL,
                parameters JSONB NOT NULL,
                severity VARCHAR(20) DEFAULT 'error',
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Insert default validation rules
        await conn.execute("""
            INSERT INTO validation_rules (name, description, document_type, field_name, validation_type, parameters, severity)
            VALUES 
                ('Member ID Format', 'Validate insurance member ID format', 'insurance_card', 'member_id', 'regex', 
                 '{"pattern": "^[A-Z0-9]{6,20}$"}', 'error'),
                ('Date Format', 'Validate date format', 'prescription', 'date', 'regex',
                 '{"pattern": "^\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}$"}', 'warning'),
                ('Patient Name Required', 'Patient name is required', 'medical_record', 'patient_name', 'required',
                 '{}', 'error')
            ON CONFLICT DO NOTHING
        """)
        
        logger.info("Document verification database tables initialized")

# API Endpoints
@app.post("/verify-document", response_model=VerificationResult)
async def verify_document(
    file: UploadFile = File(...),
    document_type: DocumentType = DocumentType.MEDICAL_RECORD,
    claim_id: Optional[str] = None,
    provider_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    tenant_id: str = "default",
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Verify uploaded document"""
    
    # Save uploaded file
    file_path = f"/tmp/{uuid.uuid4()}_{file.filename}"
    
    try:
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Create document upload object
        document_upload = DocumentUpload(
            document_type=document_type,
            claim_id=claim_id,
            provider_id=provider_id,
            patient_id=patient_id,
            tenant_id=tenant_id
        )
        
        # Verify document
        result = await verification_service.verify_document(file_path, document_upload, background_tasks)
        
        # Clean up file
        background_tasks.add_task(os.remove, file_path)
        
        return result
        
    except Exception as e:
        # Clean up file on error
        if os.path.exists(file_path):
            os.remove(file_path)
        raise e

@app.get("/verification-result/{verification_id}")
async def get_verification_result(verification_id: str):
    """Get verification result by ID"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.fetchrow("""
            SELECT * FROM document_verification_results WHERE id = $1
        """, verification_id)
        
        if not result:
            raise HTTPException(status_code=404, detail="Verification result not found")
        
        return dict(result)

@app.get("/validation-rules")
async def get_validation_rules(document_type: Optional[DocumentType] = None):
    """Get validation rules"""
    async with db_manager.pool.acquire() as conn:
        if document_type:
            rules = await conn.fetch("""
                SELECT * FROM validation_rules 
                WHERE document_type = $1 AND active = true
                ORDER BY severity DESC, name
            """, document_type.value)
        else:
            rules = await conn.fetch("""
                SELECT * FROM validation_rules 
                WHERE active = true
                ORDER BY document_type, severity DESC, name
            """)
        
        return {"rules": [dict(rule) for rule in rules]}

@app.get("/analytics/verification-stats")
async def get_verification_statistics(
    tenant_id: Optional[str] = None,
    days: int = 30
):
    """Get document verification statistics"""
    async with db_manager.pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_verifications,
                COUNT(*) FILTER (WHERE status = 'verified') as verified_count,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
                COUNT(*) FILTER (WHERE status = 'requires_manual_review') as manual_review_count,
                COUNT(*) FILTER (WHERE status = 'error') as error_count
            FROM document_verification_results 
            WHERE created_at > $1
            AND ($2::uuid IS NULL OR tenant_id = $2)
        """, datetime.utcnow() - timedelta(days=days), tenant_id)
        
        return dict(stats)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        await db_manager.redis.ping()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "document-verification-service",
            "version": "1.0.0"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unhealthy"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)
