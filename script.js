var app_options = {
    has_webcam: false,
    printing_enabled: false,
    face_step_fwd: 2,
    face_step_bwd: 0.2,
    now_playing: false, 
    draw_triangles: false,
    contrast_boost: 60
};


// Options
// -------
(function(){

    var printingcheckbox = document.getElementById("enableprint");
    printingcheckbox.addEventListener("click", function(cb){
        app_options.printing_enabled = this.checked;
    }, false);


    var playpause = document.getElementById("playpause");
    playpause.addEventListener("click", function(cb){

        // If app hasn't accessed webcam yet, run startup
        // -----
        if (!app_options.has_webcam) {
            app_options.now_playing = true;
            playpause.innerHTML = "Pause";
            get_webcam();
            return;
        }

        // Otherwise just toggle on and off
        // ----
        if (app_options.now_playing) {
            app_options.now_playing = false;
            playpause.innerHTML = "Start";
        }
        else {
            app_options.now_playing = true;
            playpause.innerHTML = "Pause";
            tick();
        }

    }, false);


    app_options.printing_enabled = printingcheckbox.checked;

})();


var video = document.getElementById('webcam');

var canvas = document.getElementById('canvas');

var triangle_canvas = document.getElementById('facets');

var face_canvas = document.getElementById('facetemp');

var fullres_canvas = document.getElementById('fullres');

var dither_canvas = document.getElementById('dither');

var log = document.getElementById('log');

var face_canvas_list = document.querySelectorAll('.justface');


function get_webcam() {
    try {
        compatibility.getUserMedia({video: true}, function(stream) {
            try {
                video.src = compatibility.URL.createObjectURL(stream);
            } catch (error) {
                video.src = stream;
            }
            setTimeout(function() {
                app_options.has_webcam = true;
                video.play();
                start_app();
                compatibility.requestAnimationFrame(tick);
            }, 500);
        }, function (error) {
            alert("Couldn't access webcam");
        });
    } catch (error) {
        alert("Couldn't even BEGIN to access webcam");
    }
}





var gui, options, ctx, triangle_ctx, face_ctx;
var img_u8, face_img_u8, corners, threshold;

var demo_opt = function(){
    this.threshold = 10;
    this.resolution = 0.4;
    this.draw_borders = false;
}


function start_app() {

    options = new demo_opt();
    //gui = new dat.GUI();
    //gui.add(options, 'threshold', 5, 100).step(1);
    var setResolution = function(resolution) {
        var cwidth = Math.floor(640*resolution);
        var cheight = Math.floor(480*resolution);
        img_u8 = new jsfeat.matrix_t(cwidth, cheight, jsfeat.U8_t | jsfeat.C1_t);
        canvas.width = cwidth;
        canvas.height = cheight;
        var style = 'visibility: hidden; -webkit-transform: scale('+1/resolution+')';                   
        //canvas['style'] = PrefixFree.prefixCSS(style);
        canvas['style'] = style;
        triangle_ctx.setTransform(1/resolution,0,0,1/resolution,0,0);
        corners = [];
        var i = cwidth*cheight;
        while(--i >= 0) {
            corners[i] = new jsfeat.point2d_t(0,0,0,0);
            corners[i].triangles = [];
        }
    }

    
    ctx = canvas.getContext('2d');
    triangle_ctx = triangle_canvas.getContext('2d');
    face_ctx = face_canvas.getContext('2d');

    setResolution(options.resolution);

    jsfeat.fast_corners.set_threshold(options.threshold);
    jsfeat.bbf.prepare_cascade(jsfeat.bbf.face_cascade);
}
            
function tick() {
    
    if (app_options.now_playing) compatibility.requestAnimationFrame(tick);

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        var cwidth = Math.floor(640*options.resolution);
        var cheight = Math.floor(480*options.resolution);




        // DRAW FRAME
        // ----------

        ctx.drawImage(video, 0, 0, cwidth, cheight);
        var imageData = ctx.getImageData(0, 0, cwidth, cheight);


        // CONVERT TO GRAYSCALE
        // --------------------
        jsfeat.imgproc.grayscale(imageData.data, img_u8.data);
        //jsfeat.imgproc.box_blur_gray(img_u8.data, img_u8.data, 10, 0);
        // ---------------------
        var data_u32 = new Uint32Array(imageData.data.buffer);
        var alpha = (0xff << 24);
        var i = img_u8.cols*img_u8.rows, pix = 0;
        while(--i >= 0) {
            pix = img_u8.data[i];
            data_u32[i] = alpha | (pix << 16) | (pix << 8) | pix;
        }
    


        // DITHERIZE
        // ---------
        // ditherize(canvas);
        // ditherize(face_canvas);
        ditherize(face_canvas_list[0]);
        // ditherize(triangle_canvas);

        // DETECT FACES
        // ------------
        var pyr = jsfeat.bbf.build_pyramid(img_u8, 24*2, 24*2, 4);
        var rects = jsfeat.bbf.detect(pyr, jsfeat.bbf.face_cascade);
        rects = jsfeat.bbf.group_rectangles(rects, 1);




        // DETECT CORNERS
        // ------------
        if(threshold != options.threshold) {
            threshold = options.threshold|0;
            jsfeat.fast_corners.set_threshold(threshold);
        }
        var count = jsfeat.fast_corners.detect(img_u8, corners, 5);


        var face_w = draw_faces(ctx, rects, cwidth/img_u8.cols, 4, canvas.width); // count up to 4 faces
        face_detected_update(face_w);
    }
}







// D3 
// -------

var sc = 4;
var width = 1200,
    height = 800;







// Facial progress bar
// ------------
var progress = document.getElementById("faceprogress");
var facesizeprogress = document.getElementById("facesizeprogress");
var datetime = document.getElementById('datetime');
var title = document.getElementById('title');
var face_log = document.getElementById("facesizelog");
var progress_value = 0;
var progress_max = 100;
var printer_paused = false;
function face_detected_update(face_w) {

    // var there_is_a_face = (face_w > 0.05 && !printer_paused);

    if (face_w > 0.05) {

        if (!printer_paused) {
            progress_value += app_options.face_step_fwd;
        }
        else {
            progress_value -= app_options.face_step_bwd;
        }
    }


    // If something is wrong..
    if (progress_value < 0) progress_value = 0;

    // Else we've reached maximum!
    else if (progress_value > progress_max) {
        progress_value = 0;


        datetime.innerHTML = moment().format('h:mm:ss A — D MMMM YYYY');

        // Print, if appropriate
        // ---------------------
        if (app_options.printing_enabled) window.print();
        else console.log("(printing!)");


        // Set printer-throttling timer
        // ----------------------------
        printer_paused = true;
        faceprogress.className = "paused";
        setTimeout(function(){
            printer_paused = false;
            faceprogress.className = "";
        }, 45 * 1000); // 45 second throttler

    } 
    progress.setAttribute("value", progress_value);
    facesizeprogress.setAttribute("value", face_w);
}
face_detected_update(false);




function draw_faces(ctx, rects, sc, max, cwid) {
    var on = rects.length;
    if(on && max) {
        jsfeat.math.qsort(rects, 0, on-1, function(a,b){return (b.confidence<a.confidence);})
    }
    var n = max || on;
    n = Math.min(n, on);
    var r;
    // console.log(n);

    face_ctx.clearRect(0,0,face_canvas.width, face_canvas.height);

    for(var i = 0; i < n; ++i) {
        r = rects[i];
        ctx.strokeRect(
            (r.x*sc)|0,
            (r.y*sc)|0,
            (r.width*sc)|0,
            (r.height*sc)|0
        );

        var inset = - r.width / 6;

        var faceData = canvas.getContext('2d').getImageData(r.x + inset, r.y + inset, r.width - inset*2, r.height - inset*2);

        face_ctx.putImageData(contrastImage(faceData, app_options.contrast_boost), 0, 0);

        face_canvas_list[i].getContext('2d').drawImage(face_canvas,0,0, (300/(r.width - inset*2)) * 300, (300/(r.height - inset*2)) * 300);
    }

    if (rects.length) return range_to_one(rects[0].width, [22,60]);

    // update_d3_face([]);

}

function contrastImage(imageData, contrast) {

    var data = imageData.data;
    var factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for(var i=0;i<data.length;i+=4)
    {
        data[i] = (factor * ((data[i] - 128) + 128));
        data[i+1] = (factor * ((data[i+1] - 128) + 128));
        data[i+2] = (factor * ((data[i+2] - 128) + 128));
    }
    return imageData;
}



var dither_worker = new Worker("dither.js");
var dither_worker_busy = false;

dither_worker.addEventListener('message', function (e) {
    dither_canvas.getContext('2d').putImageData(e.data, 0, 0);
    dither_worker_busy = false;
}, false);

function ditherize(input_canvas) {
  if (input_canvas && dither_worker && !dither_worker_busy) {
    var imageData = input_canvas.getContext('2d').getImageData(0,0, input_canvas.width, input_canvas.height);        
    dither_worker.postMessage({
      imageData: imageData,
      threshold: 0.2,
      type: "atkinson"
    });
    // Don't process a new frame until this one is done
    dither_worker_busy = true;
  }
}



// Make Child Window
// -----------------


function make_child_window() {
    var url = "http://localhost:8000/child.html";
    var width = 1200;
    var height = 800;
    var left = parseInt((screen.availWidth/2) - (width/2));
    var top = parseInt((screen.availHeight/2) - (height/2));
    var windowFeatures = "width=" + width + ",height=" + height +   
        ",status,resizable,left=" + left + ",top=" + top + 
        "screenX=" + left + ",screenY=" + top + ",scrollbars=yes";

    return window.open(url, "subWind", windowFeatures, "POS");
}






// 0-1 to Range and Range to 0-1
// -----------------------------

//        (b-a)(x - min)
// f(x) = --------------  + a
//           max - min

function range_to_range (x, inp, out) {
    return ( ( (out[1] - out[0])*(x - inp[0]) ) / (inp[1] - inp[0]) + out[0] );
}

function one_to_range (x, output_range) {
    return range_to_range(x, [0,1], output_range);
}

function range_to_one (x, input_range) {
    return range_to_range(x, input_range, [0,1]);
}


