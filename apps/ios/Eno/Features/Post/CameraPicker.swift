import SwiftUI
import UIKit

// Camera capture for the Post wizard — SwiftUI's PhotosPicker only reaches the
// library, so "Take Photo"/"Take Video" need UIImagePickerController with the
// .camera source (requires NSCameraUsageDescription, plus NSMicrophoneUsageDescription
// for video). Returns either the captured UIImage or a temp movie file URL.
struct CameraPicker: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    var video = false
    var onImage: ((UIImage) -> Void)? = nil
    var onVideo: ((URL) -> Void)? = nil

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        if video {
            picker.mediaTypes = ["public.movie"]
            picker.cameraCaptureMode = .video
            picker.videoMaximumDuration = 60
            picker.videoQuality = .typeMedium
        } else {
            picker.mediaTypes = ["public.image"]
        }
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if parent.video, let url = info[.mediaURL] as? URL {
                parent.onVideo?(url)
            } else if let image = info[.originalImage] as? UIImage {
                parent.onImage?(image)
            }
            parent.isPresented = false
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.isPresented = false
        }
    }
}
