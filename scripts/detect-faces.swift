// Face detection via Apple's Vision framework.
//
// Emits one JSON object per image on stdout with the face bounding box in pixel
// coordinates (top-left origin), which the Node side uses to crop every photo so
// the face occupies a consistent fraction of the frame.
//
// Build: swiftc -O scripts/detect-faces.swift -o data/bin/detect-faces
// Run:   detect-faces <image>...

import Foundation
import Vision
import CoreImage

struct Face: Codable {
    let x: Int, y: Int, width: Int, height: Int
    let confidence: Float
}

struct Result: Codable {
    let path: String
    let width: Int
    let height: Int
    let faces: [Face]
    let error: String?
}

let encoder = JSONEncoder()

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)

    guard let image = CIImage(contentsOf: url) else {
        let r = Result(path: path, width: 0, height: 0, faces: [], error: "could not decode")
        print(String(data: try! encoder.encode(r), encoding: .utf8)!)
        continue
    }

    let w = Int(image.extent.width)
    let h = Int(image.extent.height)

    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(ciImage: image, options: [:])

    var faces: [Face] = []
    var errorText: String? = nil

    do {
        try handler.perform([request])
        for observation in request.results ?? [] {
            // Vision returns normalised coords with a bottom-left origin; convert
            // to top-left pixel coords to match how sharp crops.
            let b = observation.boundingBox
            faces.append(
                Face(
                    x: Int(b.origin.x * CGFloat(w)),
                    y: Int((1.0 - b.origin.y - b.height) * CGFloat(h)),
                    width: Int(b.width * CGFloat(w)),
                    height: Int(b.height * CGFloat(h)),
                    confidence: observation.confidence
                )
            )
        }
    } catch {
        errorText = "\(error)"
    }

    // Largest face first — group shots and reflections should not win.
    faces.sort { $0.width * $0.height > $1.width * $1.height }

    let r = Result(path: path, width: w, height: h, faces: faces, error: errorText)
    print(String(data: try! encoder.encode(r), encoding: .utf8)!)
}
