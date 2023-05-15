// ES6
import * as sdpTransform from 'sdp-transform';
import {getFakeMedia} from "getfakemedia";

interface GetSupportInfoResult{
    gpu: string,
    supportsH264: 'yes'|'no'|'unknown',
    supportsH264Hardware: 'yes'|'no'|'unknown'
    encoderImplementation: string
}

let pcSend:RTCPeerConnection|null = null
let pcRecv:RTCPeerConnection|null = null
let videoTrack:MediaStreamTrack|null = null
let timer:any = null

let dumpSize = 0
const DUMP_SIZE_MAX = 10000000
let dumpStartAt = 0
let dumpEndAt = 0
let dumpKey = 0
let dumpDelta = 0

let dumpBuffer: ArrayBuffer[] = []
let trackType = ''

const start = async ()=>{
    trackType = (document.getElementById('trackType') as HTMLSelectElement).value
    const enableDump = (document.getElementById('enableDump') as HTMLInputElement).checked
    const $dumpSize = (document.getElementById('dumpSize') as HTMLSpanElement)
    const $keyFrameCnt = (document.getElementById('keyFrameCnt') as HTMLSpanElement)
    const $deltaFrameCnt = (document.getElementById('deltaFrameCnt') as HTMLSpanElement)
    const $duation = (document.getElementById('duration') as HTMLSpanElement)

    dumpSize = 0
    dumpStartAt = 0
    dumpEndAt = 0
    dumpKey = 0
    dumpDelta = 0
    dumpBuffer = []

    const result:GetSupportInfoResult = {
        gpu: 'unknown',
        supportsH264: 'unknown',
        supportsH264Hardware: 'unknown',
        encoderImplementation: 'unknown'
    }

    try{
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl')
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                result.gpu = renderer
            }
        }
    } catch(e) {
        console.error(e)
    }

    pcSend = new RTCPeerConnection({
        // @ts-ignore
        encodedInsertableStreams: enableDump
    })

    pcRecv = new RTCPeerConnection()
    pcSend.onicecandidate = (evt)=>{
        if (evt.candidate){
            pcRecv?.addIceCandidate(evt.candidate)
        }
    }
    pcRecv.ontrack = (evt) =>{
        const $video = document.getElementById('remoteVideo') as HTMLVideoElement
        if (!$video.srcObject){
            $video.srcObject = new MediaStream()
            $video.onresize = (evt)=>{
                console.log(`resize`, $video.clientWidth, $video.clientHeight)
            }
        }
        ($video.srcObject as MediaStream).addTrack(evt.track)
        $video.style.display = 'block'
        $video.play()
    }
    if (trackType === 'canvas'){
        const fakeMedia = getFakeMedia({
            video: {
                type: 'clock',
                width: 640,
                height: 480,
                frameRate: 15,
            }, audio: false})
        if (!fakeMedia.video?.track){
            return result
        }
        videoTrack = fakeMedia.video.track
    } else if (trackType === 'displayMedia'){
        const displayMedia = await navigator.mediaDevices.getDisplayMedia({video: true})
        videoTrack = displayMedia.getVideoTracks()[0]
    } else if (trackType === 'camera') {
        const userMedia = await navigator.mediaDevices.getUserMedia({video: true})
        videoTrack = userMedia.getVideoTracks()[0]
    } else {
        return result
    }
    pcSend.addTrack(videoTrack)
    const offer1 = await pcSend.createOffer()
    if (!offer1.sdp) {
        return result
    }
    if (offer1.sdp.indexOf('H264') > -1){
        result.supportsH264 = 'yes'
    } else {
        result.supportsH264 = 'no'
    }
    const res = sdpTransform.parse(offer1.sdp)
    // console.log(JSON.stringify(res.media[0].rtp, null, 2))
    // console.log(JSON.stringify(res.media[0].fmtp, null, 2))
    // 在这里删除其他codec
    // @ts-ignore
    let H264CodecKeyword = document.getElementById('profileLevel').value

    let H264PayloadToDelete: number[] = []
    let payloadsToDelete: number[] = []
    let hasProfileKeyword = false
    for (let i = res.media[0].fmtp.length - 1; i >= 0; i--){
        if (res.media[0].fmtp[i].config.indexOf('profile-level-id') !== -1){
            if (res.media[0].fmtp[i].config.indexOf(H264CodecKeyword) === -1){
                H264PayloadToDelete.push(res.media[0].fmtp[i].payload)
            } else {
                hasProfileKeyword = true
            }
        }
    }
    for (let i = res.media[0].rtp.length - 1; i >= 0; i--){
        if (['VP8', 'VP9', 'AV1'].indexOf(res.media[0].rtp[i].codec) !== -1 ||
            (hasProfileKeyword && H264PayloadToDelete.indexOf(res.media[0].rtp[i].payload) !== -1)){
            payloadsToDelete.push(res.media[0].rtp[i].payload)
            payloadsToDelete.push(res.media[0].rtp[i + 1].payload)
            res.media[0].rtp.splice(i, 2)
        }
    }
    let payloadArr = res.media[0].payloads?.split(' ')
    if (payloadArr){
        payloadArr = payloadArr.filter((payloadId)=>{
            return payloadsToDelete.indexOf(parseInt(payloadId)) === -1
        })
        res.media[0].payloads = payloadArr.join(' ')
    }
    for (let i = res.media[0].fmtp.length - 1; i >= 0; i--){
        if (payloadsToDelete.indexOf(res.media[0].fmtp[i].payload) !== -1){
            res.media[0].fmtp.splice(i, 1)
        }
    }
    if (res.media[0].rtcpFb){
        for (let i = res.media[0].rtcpFb.length - 1; i >= 0; i--){
            if (payloadsToDelete.indexOf(res.media[0].rtcpFb[i].payload) !== -1){
                res.media[0].rtcpFb.splice(i, 1)
            }
        }
    }

    // console.log('res', res)
    const sdp = sdpTransform.write(res)
    const offer2 = new RTCSessionDescription({
        type: 'offer',
        sdp: sdp
    })
    await pcSend.setLocalDescription(offer2)
    await pcRecv.setRemoteDescription(offer2)
    const answer = await pcRecv.createAnswer()
    await pcRecv.setLocalDescription(answer)
    await pcSend.setRemoteDescription(answer)

    if (enableDump){
        // @ts-ignore
        const senderStreams = pcSend.getSenders()[0].createEncodedStreams()
        console.error(`senderStreams`, senderStreams)
        const readableStream = senderStreams.readable;
        const writableStream = senderStreams.writable;
        const transformStream = new TransformStream({
            transform: (chunk:RTCEncodedVideoFrame, controller)=>{
                if (dumpSize + chunk.data.byteLength > DUMP_SIZE_MAX) {
                    return
                }

                if (chunk.type === 'key'){
                    console.error(`key frame`, chunk)
                }

                if (!dumpStartAt){
                    dumpStartAt = Date.now()
                }
                dumpEndAt = Date.now()
                if (chunk.type === 'key'){
                    dumpKey++
                } else if (chunk.type === 'delta'){
                    dumpDelta++
                }

                dumpSize += chunk.data.byteLength
                const buffer = chunk.data.slice(0)
                dumpBuffer.push(buffer)
                controller.enqueue(chunk)

                $dumpSize.innerHTML = `${Math.ceil(dumpSize / 1024)}KB`
                $keyFrameCnt.innerHTML = `${dumpKey}`
                $deltaFrameCnt.innerHTML = `${dumpDelta}`
                $duation.innerHTML = `${Math.floor((dumpEndAt - dumpStartAt) / 60000)}:${Math.floor((dumpEndAt - dumpStartAt) / 1000 % 60).toString().padStart(2, '0')}.${Math.floor((dumpEndAt - dumpStartAt) % 1000).toString().padStart(3, '0')}`
            },
        });
        readableStream
            .pipeThrough(transformStream)
            .pipeTo(writableStream);
    }


    let lastStats: RTCStatsReport|null = null
    const updateStats = async ()=>{
        if (!pcSend) return
        const stats = await pcSend.getStats(null)
        lastStats = stats
        stats.forEach((report)=>{
            if (report.encoderImplementation && report.encoderImplementation !== 'unknown'){
                result.encoderImplementation = report.encoderImplementation
            }
        })
        if (result.encoderImplementation === 'OpenH264') {
            result.supportsH264Hardware = 'no'
        } else if (result.encoderImplementation !== 'unknown') {
            result.supportsH264Hardware = 'yes'
        }
        const $elem = document.getElementById('result')
        const html = `<h1><pre>${JSON.stringify(result, null, 2)}</pre></h1>`
        if ($elem && $elem.innerHTML !== html ){
            console.error(`Changed Codec Result`, $elem.innerHTML, html)
            $elem.innerHTML = html
        }
    }
    timer = setInterval(updateStats, 100)
    // lastStats && lastStats.forEach((report)=>{
    //     if (report.encoderImplementation && report.encoderImplementation !== 'unknown'){
    //         result.encoderImplementation = report.encoderImplementation
    //     }
    //     Object.keys(report).forEach((key)=>{
    //         console.log(key, report[key])
    //     })
    // })

    // videoTrack.stop()
    // pcSend.close()
    // pcRecv.close()

    //
    // return result
}

async function stop(){
    console.error(`stop`)
    if (dumpBuffer.length){
        const blob = new Blob(dumpBuffer, {type: "application/file"});
        const link = document.createElement('a');
        link.href=window.URL.createObjectURL(blob);
        // @ts-ignore
        link.download=`send.${trackType}.${Math.ceil((dumpEndAt - dumpStartAt) / 1000)}s.k${dumpKey}d${dumpDelta}.${document.getElementById('profileLevel').value}.h264`;
        link.click();
    }
    pcSend?.close()
    pcRecv?.close()
    videoTrack?.stop()
    clearInterval(timer)
    pcSend = pcRecv = videoTrack = null
}

const main = async ()=>{
    // @ts-ignore
    if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.prototype.createEncodedStreams){
        const $enableDump = document.getElementById('enableDump') as HTMLInputElement
        console.error($enableDump)
            if ($enableDump){
                $enableDump.disabled = false
                $enableDump.checked = true
            }
    }

    (document.getElementById('stop') as HTMLButtonElement).onclick = stop;
    (document.getElementById('start') as HTMLButtonElement).onclick = start;

}

main()


