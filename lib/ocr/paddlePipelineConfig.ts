/**
 * Pipeline options sent to the PaddleOCR.js 0.4.2 worker `init` message.
 * Captured from PaddleOCR.create() for the pinned mobile models.
 * Asset URLs are applied by the client from lib/ocr/constants.ts.
 */
export const PADDLE_PIPELINE_CONFIG = {
  pipelineName: "OCR",
  raw: {
    pipeline_name: "OCR",
    text_type: "general",
    use_doc_preprocessor: false,
    use_textline_orientation: false,
    SubPipelines: {
      DocPreprocessor: {
        pipeline_name: "doc_preprocessor",
        use_doc_orientation_classify: false,
        use_doc_unwarping: false,
        SubModules: {
          DocOrientationClassify: {
            module_name: "doc_text_orientation",
            model_name: "PP-LCNet_x1_0_doc_ori",
            model_dir: null,
          },
          DocUnwarping: {
            module_name: "image_unwarping",
            model_name: "UVDoc",
            model_dir: null,
          },
        },
      },
    },
    SubModules: {
      TextDetection: {
        module_name: "text_detection",
        model_name: "PP-OCRv5_mobile_det",
        model_dir: null,
        limit_side_len: 64,
        limit_type: "min",
        max_side_limit: 4000,
        thresh: 0.3,
        box_thresh: 0.6,
        unclip_ratio: 1.5,
      },
      TextLineOrientation: {
        module_name: "textline_orientation",
        model_name: "PP-LCNet_x1_0_textline_ori",
        model_dir: null,
        batch_size: 6,
      },
      TextRecognition: {
        module_name: "text_recognition",
        model_name: "PP-OCRv5_mobile_rec",
        model_dir: null,
        batch_size: 6,
        score_thresh: 0,
      },
    },
  },
  warnings: [
    "DocPreprocessor is not yet supported in PaddleOCR.js: config will be ignored for now.",
    "TextLineOrientation is not yet supported in PaddleOCR.js: config will be ignored for now.",
  ],
  unsupportedFeatures: ["DocPreprocessor", "TextLineOrientation"],
  modelSelection: {
    textDetectionModelName: "PP-OCRv5_mobile_det",
    textRecognitionModelName: "PP-OCRv5_mobile_rec",
  },
  runtimeDefaults: {
    text_det_limit_side_len: 64,
    text_det_limit_type: "min",
    text_det_max_side_limit: 4000,
    text_det_thresh: 0.3,
    text_det_box_thresh: 0.6,
    text_det_unclip_ratio: 1.5,
    text_rec_score_thresh: 0,
  },
  pipelineBatchSize: 1,
  textDetectionBatchSize: 1,
  textRecognitionBatchSize: 6,
} as const
