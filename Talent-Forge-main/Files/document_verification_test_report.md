# Vision-S Backend Document Verification Test Report

**Date:** 2026-08-21
**Base URL:** https://dev-api.talentforge.com.sa
**User:** abdul.musawwir@bytecorp.io

## Summary

| Metric | Count |
|--------|-------|
| Total Test Documents | 38 |
| Successfully Uploaded | 39 |
| Correctly Rejected | 2 |
| AWAITING | 28 |
| REVISION | 10 |
| APPROVED | 0 |

## API Endpoints Used

### Authentication
```
POST /core/api/v1/auth/token/
Body: {"email": "...", "password": "..."}
```

### Education Upload
```
POST /core/api/v1/candidate/profile/educations/
Form-data: institution, degree, field_of_study_id, start_date, end_date, file
```

### Work Experience Upload
```
POST /core/api/v1/candidate/profile/work-experiences/
Form-data: company, experience, designation, start_date, end_date, file
```

### Certification Upload
```
POST /core/api/v1/candidate/profile/certifications/
Form-data: certificate_name, issuing_organization, issue_date, expiry_date, file
```

### Document Retrieval
```
GET /core/api/v1/candidate/documents/all/
GET /core/api/v1/candidate/profile/me/
```

## Document-by-Document Results

### AUTH

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| AUTH-01_certificate_ordinary_scan.pdf | AWAITING | issuing_organisation | authenticity | OK |
| AUTH-02_transcript_visible_tampering.pdf | AWAITING | issuing_organisation | authenticity | **DISCREPANCY:** authenticity: expected 'fail' but got 'uncertain' |
| AUTH-03_e_transcript_no_digital_cert.pdf | REVISION | transcript_content, issuing_organisation | authenticity | The document is an E-Transcript Digital Credential with no seal, making authenticity uncertain. Transcript is missing: g... |
| AUTH-04_genuine_e_transcript_faint_seal.png | REVISION | transcript_content | authenticity | The document appears to be a scan or photo, but the quality is poor, making it difficult to assess for tampering or forg... |
| AUTH-05_too_degraded_to_judge.png | REVISION | transcript_content, issuing_organisation | date_validity, authenticity, identity_name_match, cross_document_consistency | The dates are not present or well formed. The document is too degraded to judge either way. Transcript is missing: degre... |

### CONT

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| CONT-01_transcript_complete.pdf | AWAITING | issuing_organisation | authenticity | OK |
| CONT-02_transcript_missing_major.pdf | REVISION | transcript_content, issuing_organisation | authenticity | The document appears to be a scan or printout, but there is no visible evidence of tampering or forgery. However, the do... |
| CONT-03_transcript_only_degree.pdf | REVISION | transcript_content, issuing_organisation | authenticity | The document appears to be a scan or printout, but there is no visible evidence of tampering or forgery. However, the au... |
| CONT-04_work_letter_exempt.pdf | AWAITING | issuing_organisation | authenticity | OK |

### DATE

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| DATE-01_transcript_future_conferral.pdf | REVISION | date_validity, issuing_organisation | - | Conferral date is in the future: 2030-06-15 The issuing organisation on the document is King Saud University, which does... |
| DATE-02_work_letter_current_open_end.pdf | AWAITING | issuing_organisation | - | OK |
| DATE-03_transcript_malformed_date.pdf | AWAITING | issuing_organisation | authenticity | **DISCREPANCY:** date_validity: expected 'fail' but got 'pass' |
| DATE-04_certificate_expiry_before_issue.pdf | REVISION | date_validity, issuing_organisation | authenticity | Expiry date is earlier than the issue date The document appears to be a scan or printout, but there is no visible eviden... |
| DATE-05_certificate_valid_dates.pdf | AWAITING | issuing_organisation | authenticity | OK |

### EDGE

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| EDGE-03_reupload_corrected_name.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |

### ENG

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| ENG-01_clean_transcript_all_pass.pdf | AWAITING | issuing_organisation | authenticity | **DISCREPANCY:** Expected APPROVED but got AWAITING |
| ENG-02_certificate_future_issue_date.pdf | AWAITING | issuing_organisation | authenticity | **DISCREPANCY:** date_validity: expected 'fail' but got 'pass' |
| ENG-03_transcript_name_mismatch.pdf | AWAITING | identity_name_match, cross_document_consistency, issuing_organisation | - | OK |
| ENG-04_transcript_malformed_date_unknown_institution.pdf | REVISION | transcript_content, cross_document_consistency, issuing_organisation | - | **DISCREPANCY:** date_validity: expected 'fail' but got 'pass' |
| ENG-05_blurry_legible_scan.png | AWAITING | cross_document_consistency | authenticity | OK |
| ENG-06_certificate_minimal_fields.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| ENG-07_work_experience_letter.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |

### FILE

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| FILE-01_allowed_pdf.pdf | REVISION | transcript_content, cross_document_consistency, issuing_organisation | authenticity | The document appears to be a sample, so authenticity cannot be determined. Transcript is missing: major/field of study, ... |
| FILE-01_allowed_png.png | AWAITING | cross_document_consistency | authenticity | OK |
| FILE-03_oversized_above_5mb.pdf | AWAITING | - | automated_check | **DISCREPANCY:** upload_rejected: expected 'True' but got 'N/A'; Expected upload rejection but was uploaded |
| FILE-04_between_4_5_and_5mb.pdf | AWAITING | - | automated_check | AI Error: Document is 4952868 bytes, over the 4718592 byte Converse inline limit |
| FILE-05_presigned_download_safety.pdf | REVISION | transcript_content, cross_document_consistency, issuing_organisation | authenticity | The document appears to be a scan or printout, but there is no clear indication of tampering or forgery. However, the la... |

### NAME

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| NAME-01_transcript_exact_name.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| NAME-02_transcript_spacing_variance.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| NAME-03_transcript_different_name.pdf | AWAITING | identity_name_match, cross_document_consistency | authenticity | OK |
| NAME-04_transcript_name_conflict.pdf | AWAITING | identity_name_match, cross_document_consistency, issuing_organisation | authenticity | OK |
| NAME-05_transcript_same_name_second_doc.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| NAME-06_transcript_first_ever_doc.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |

### ORG

| File | Status | Fails | Uncertain | Notes |
|------|--------|-------|-----------|-------|
| ORG-01_transcript_known_institution.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| ORG-02_work_letter_verified_company.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| ORG-03_transcript_unknown_institution.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |
| ORG-04_work_letter_unverified_company.pdf | AWAITING | cross_document_consistency, issuing_organisation | - | OK |
| ORG-05_transcript_no_issuer.pdf | AWAITING | cross_document_consistency, issuing_organisation | authenticity | OK |

## Rejected Uploads

| File | Expected | Actual | Status |
|------|----------|--------|--------|
| FILE-02_disallowed_docx.docx | Rejected | HTTP 422 | Correctly rejected |
| FILE-02_disallowed_jpg.jpg | Rejected | HTTP 422 | Correctly rejected |

## Discrepancies Found

1. AUTH-02_transcript_visible_tampering.pdf: authenticity: expected 'fail' but got 'uncertain'
2. DATE-03_transcript_malformed_date.pdf: date_validity: expected 'fail' but got 'pass'
3. ENG-01_clean_transcript_all_pass.pdf: Expected APPROVED but got AWAITING
4. ENG-02_certificate_future_issue_date.pdf: date_validity: expected 'fail' but got 'pass'
5. ENG-04_transcript_malformed_date_unknown_institution.pdf: date_validity: expected 'fail' but got 'pass'
6. FILE-03_oversized_above_5mb.pdf: upload_rejected: expected 'True' but got 'N/A'
7. FILE-03_oversized_above_5mb.pdf: Expected upload rejection but was uploaded

## Recommendations

1. **Institution Declaration Mismatch**: Most documents show `issuing_organisation=fail` because the test documents list 'King Saud University' but the declared institution is 'Al Asala College'. This is expected behavior.

2. **AI Model Gaps**: The amazon.nova-pro-v1:0 model sometimes misses:
   - Visible tampering in PDFs
   - Malformed dates
   - Future issue dates

3. **File Size**: Oversized files (>5MB) upload successfully but AI fails with size limit error. Consider adding pre-upload size validation.

4. **Test Document Quality**: Some test documents may not actually contain the defects described in their filenames.