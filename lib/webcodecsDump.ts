import {getFakeMedia} from "getfakemedia";
import {VideoTypes} from "getfakemedia/types/video/video";

let videoEncoder: VideoEncoder|null = null
let videoTrack:MediaStreamTrack|null = null

const WIDTH = 1280
const HEIGHT = 720
const FRAMERATE = 60

const START_CODE = new Uint8Array([ 0, 0, 0, 1 ]);
const DUMP_SIZE_MAX = 10000000
let dumpBuffer: ArrayBuffer[] = []
let dumpSize = 0
let timer:any = null

function parseAVCC (avcc: ArrayBuffer) {
    const view = new DataView(avcc);
    let off = 0;
    const version = view.getUint8(off++)
    const profile = view.getUint8(off++);
    const compat = view.getUint8(off++);
    const level = view.getUint8(off++);
    const length_size = (view.getUint8(off++) & 0x3) + 1;
    if (length_size !== 4) throw new Error('Expected length_size to indicate 4 bytes')
    const numSPS = view.getUint8(off++) & 0x1f;
    const sps_list = [];
    for (let i = 0; i < numSPS; i++) {
        const sps_len = view.getUint16(off, false);
        off += 2;
        const sps = new Uint8Array(view.buffer, off, sps_len);
        sps_list.push(sps);
        off += sps_len;
    }
    const numPPS = view.getUint8(off++);
    const pps_list = [];
    for (let i = 0; i < numPPS; i++) {
        const pps_len = view.getUint16(off, false);
        off += 2;
        const pps = new Uint8Array(view.buffer, off, pps_len);
        pps_list.push(pps)
        off += pps_len;
    }
    return {
        offset: off,
        version,
        profile,
        compat,
        level,
        length_size,
        pps_list,
        sps_list,
        numSPS
    }
}

function convertAVCToAnnexBInPlaceForLength4 (arrayBuf:ArrayBuffer) {
    const kLengthSize = 4;
    let pos = 0;
    const chunks = [];
    const size = arrayBuf.byteLength;
    const uint8 = new Uint8Array(arrayBuf);
    while (pos + kLengthSize < size) {
        // read uint 32, 4 byte NAL length
        let nal_length = uint8[pos];
        nal_length = (nal_length << 8) + uint8[pos+1];
        nal_length = (nal_length << 8) + uint8[pos+2];
        nal_length = (nal_length << 8) + uint8[pos+3];

        chunks.push(new Uint8Array(arrayBuf, pos + kLengthSize, nal_length));
        if (nal_length == 0) throw new Error('erro')
        pos += kLengthSize + nal_length;
    }
    return chunks;
}

const main = async ()=>{
    const fakeMedia = getFakeMedia({
        video: {
            type: 'clock',
            width: WIDTH,
            height: HEIGHT,
            frameRate: FRAMERATE,
        }, audio: false})
    if (!fakeMedia.video?.track){
        return
    }
    videoTrack = fakeMedia.video.track
    const $video = document.getElementById('sourceVideo') as HTMLVideoElement
    $video.srcObject = new MediaStream([videoTrack])


    const config:VideoEncoderConfig = {
        // codec: 'avc1.4d401e',
        // codec: 'avc1.4d002a',
        // codec: 'avc1.4d0028',
        codec: 'avc1.42001f',

        // progressive
        // codec: 'avc1.6e0034',
        width: WIDTH,
        height: HEIGHT,
        avc: {
            format: 'annexb',
        },
        hardwareAcceleration: 'prefer-hardware',
        // acceleration: 'allow',
        bitrate: 1_000_000, // N Mbps
        // framerate: fps,
    };

    const init:VideoEncoderInit = {
        output: (chunk, opts) => {
            console.log('output', dumpBuffer.length, chunk, opts)
            const buffer = new ArrayBuffer(chunk.byteLength)
            chunk.copyTo(buffer)
            if (opts.decoderConfig?.description) {
                // @ts-ignore
                const avccConfig = parseAVCC(opts.decoderConfig.description);
                if (avccConfig) {
                    avccConfig.sps_list.forEach(sps => {
                        dumpBuffer.push(START_CODE.buffer.slice(0));
                        console.error('sps', sps)
                        dumpBuffer.push(sps.buffer.slice(0));
                    });
                    avccConfig.pps_list.forEach(pps => {
                        console.error('pps', pps)
                        dumpBuffer.push(START_CODE.buffer.slice(0));
                        dumpBuffer.push(pps.buffer.slice(0));
                    });
                }
            }

            dumpBuffer.push(buffer)
            if (dumpBuffer.length > 300){
                if (dumpBuffer.length){
                    const blob = new Blob(dumpBuffer, {type: "application/file"});
                    const link = document.createElement('a');
                    link.href=window.URL.createObjectURL(blob);
                    link.download=`send.h264`;
                    link.click();
                    clearInterval(timer)
                }
            }
        },
        error: (e) => {
            console.error(e.message);
        }
    };
    const encoder = new VideoEncoder(init)
    encoder.configure(config)

    let i = 0
    const encodeFrame = ()=>{
        const frame = new VideoFrame($video, {})
        const ret = encoder.encode(frame, {keyFrame: i % 50 < 15 })
        i++
        console.log('ret', ret)
        frame.close()
    }
    timer = setInterval(encodeFrame, 1000 / FRAMERATE)
}

main()
