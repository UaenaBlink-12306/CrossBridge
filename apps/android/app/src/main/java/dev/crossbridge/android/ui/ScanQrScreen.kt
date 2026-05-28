package dev.crossbridge.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import dev.crossbridge.android.protocol.PairingQrParser
import dev.crossbridge.android.protocol.PairingQrParseResult
import dev.crossbridge.android.protocol.PairingQrPayload
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.Executors

private const val TAG = "ScanQrScreen"

@Composable
fun ScanQrScreen(
    onBack: () -> Unit,
    onPayloadReady: (PairingQrPayload) -> Unit,
    onPasteQrJson: () -> Unit
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var permissionRequested by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var isProcessingQr by remember { mutableStateOf(false) }
    var lastProcessedQr by remember { mutableStateOf<String?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        permissionRequested = true
    }

    // Request camera permission on first composition if not already granted
    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Scan QR code",
            style = MaterialTheme.typography.headlineSmall
        )

        if (hasCameraPermission) {
            Text(
                text = "Point your camera at the QR code on the Windows Pair page.",
                style = MaterialTheme.typography.bodyMedium
            )

            // Camera preview with QR scanning
            CameraQrPreview(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(16.dp)),
                onQrDetected = { rawText ->
                    if (isProcessingQr || lastProcessedQr == rawText) return@CameraQrPreview
                    isProcessingQr = true
                    lastProcessedQr = rawText

                    when (val result = PairingQrParser.parse(rawText)) {
                        is PairingQrParseResult.Success -> {
                            error = null
                            onPayloadReady(result.payload)
                        }
                        is PairingQrParseResult.Failure -> {
                            error = result.error.message
                            isProcessingQr = false
                        }
                    }
                }
            )
        } else if (permissionRequested) {
            // Permission was denied
            Text(
                text = "Camera permission is needed to scan QR codes.",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "You can grant camera permission in your device settings, or use the QR JSON paste option below.",
                style = MaterialTheme.typography.bodySmall
            )
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }
            ) {
                Text("Grant camera permission")
            }
        } else {
            // Waiting for permission dialog
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "Requesting camera permission…",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        if (error != null) {
            Text(
                text = error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onPasteQrJson
        ) {
            Text("Paste pairing text instead")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onBack
        ) {
            Text("Back")
        }
    }
}

@OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraQrPreview(
    modifier: Modifier = Modifier,
    onQrDetected: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val barcodeScanner = remember { BarcodeScanning.getClient() }
    val latestOnQrDetected = rememberUpdatedState(onQrDetected)
    val cameraProviderRef = remember { AtomicReference<ProcessCameraProvider?>() }
    val disposed = remember { AtomicBoolean(false) }

    DisposableEffect(Unit) {
        onDispose {
            disposed.set(true)
            cameraProviderRef.get()?.unbindAll()
            cameraExecutor.shutdown()
            barcodeScanner.close()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val previewView = PreviewView(ctx)

            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                if (disposed.get()) {
                    cameraProvider.unbindAll()
                    return@addListener
                }
                cameraProviderRef.set(cameraProvider)

                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }

                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    processImageForQr(imageProxy, barcodeScanner) { rawText ->
                        latestOnQrDetected.value(rawText)
                    }
                }

                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        imageAnalysis
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Camera bind failed", e)
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        }
    )
}

@OptIn(ExperimentalGetImage::class)
private fun processImageForQr(
    imageProxy: ImageProxy,
    barcodeScanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    onQrDetected: (String) -> Unit
) {
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
        imageProxy.close()
        return
    }

    val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

    barcodeScanner.process(inputImage)
        .addOnSuccessListener { barcodes ->
            for (barcode in barcodes) {
                if (barcode.format == Barcode.FORMAT_QR_CODE) {
                    val rawValue = barcode.rawValue
                    if (!rawValue.isNullOrBlank()) {
                        onQrDetected(rawValue)
                        break
                    }
                }
            }
        }
        .addOnFailureListener { e ->
            Log.w(TAG, "Barcode scan failed", e)
        }
        .addOnCompleteListener {
            imageProxy.close()
        }
}
