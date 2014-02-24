var app_options = {
    has_webcam: false,
    printing_enabled: false,
    face_step_fwd: 2,
    face_step_bwd: 0.2,
    now_playing: false, 
    draw_triangles: false
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
var face_canvas = document.querySelector('.justface');
var dither_canvas = document.getElementById('dither');
var log = document.getElementById('log');



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





var stat = new profiler();

var gui, options, ctx, triangle_ctx, face_ctx;
var img_u8, face_img_u8, corners, threshold;

var demo_opt = function(){
    this.threshold = 10;
    this.resolution = 1;
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


    stat.add("capture");
    stat.add("grayscale");
    stat.add("fast corners");
    stat.add("triangles");
    stat.add("rendering");
    
    ctx = canvas.getContext('2d');
    triangle_ctx = triangle_canvas.getContext('2d');
    face_ctx = face_canvas.getContext('2d');

    setResolution(options.resolution);

    jsfeat.fast_corners.set_threshold(options.threshold);
    jsfeat.bbf.prepare_cascade(jsfeat.bbf.face_cascade);
}
            
function tick() {
    
    if (app_options.now_playing) compatibility.requestAnimationFrame(tick);

    stat.new_frame();
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        var cwidth = Math.floor(640*options.resolution);
        var cheight = Math.floor(480*options.resolution);




        // DRAW FRAME
        // ----------

        stat.start("capture");
        ctx.drawImage(video, 0, 0, cwidth, cheight);
        var imageData = ctx.getImageData(0, 0, cwidth, cheight);
        stat.stop("capture");



        // CONVERT TO GRAYSCALE
        // --------------------
        stat.start("grayscale");
        jsfeat.imgproc.grayscale(imageData.data, img_u8.data);
        //jsfeat.imgproc.box_blur_gray(img_u8.data, img_u8.data, 10, 0);
        stat.stop("grayscale");
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
        ditherize(face_canvas);
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
        stat.start("fast corners");
        var count = jsfeat.fast_corners.detect(img_u8, corners, 5);
        stat.stop("fast corners");

        var face_w = draw_faces(ctx, rects, cwidth/img_u8.cols, 4, canvas.width); // count up to 4 faces
        face_detected_update(face_w);


        if (app_options.draw_triangles) {

            // TRIANGULATE
            // --------

            stat.start("triangles");
            var vertices = [];//{x:0,y:0},{x:cwidth,y:0},{x:cwidth,y:cheight},{x:0,y:cheight}];
            for(var i=0;i<count;i++) {
                vertices.push(corners[i]);
            }
            var triangles = triangulate(vertices);

            // update_d3(vertices);

            stat.stop("triangles");



            function getTriangleColor(img,triangle) {
                var getColor = function (point) {
                    var offset = (point.x+point.y*cwidth)*4;
                    return img.data[offset];
                }
                var midPoint = function (point1,point2) {
                    return {x:(point1.x+point2.x)/2,
                            y:(point1.y+point2.y)/2};
                }
                // Pick a point inside the triangle
                var point1 = midPoint(triangle.a,triangle.b);
                var point = midPoint(point1,triangle.c);
                return getColor({x:Math.floor(point.x),y:Math.floor(point.y)});
            }


            // RENDER
            // ------

            stat.start("rendering");

            // var face_w = draw_faces(triangle_ctx, rects, cwidth/img_u8.cols, 4, canvas.width); // count up to 4 faces
            // face_detected_update(face_w);

            triangle_ctx.scale(-1, 1);
            triangle_ctx.fillStyle = 'rgb(255,255,255)';
            triangle_ctx.fillRect ( 0 , 0 , canvas.width , canvas.height);

            for(var i=0;i<triangles.length;i++) {
                var color = triangles[i].color = getTriangleColor(imageData,triangles[i]);

                // if (color < 110) color = 0;
                // else color = 255;

                triangle_ctx.fillStyle = 'rgb('+
                    color +','+
                    color +','+
                    color +')';

                triangle_ctx.beginPath();
                    triangle_ctx.moveTo(canvas.width - triangles[i].a.x,triangles[i].a.y);
                    triangle_ctx.lineTo(canvas.width - triangles[i].b.x,triangles[i].b.y);
                    triangle_ctx.lineTo(canvas.width - triangles[i].c.x,triangles[i].c.y);
                triangle_ctx.closePath();

                // triangle_ctx.setLineDash([1,5]);
                // triangle_ctx.lineWidth = 0.1;
                // triangle_ctx.strokeStyle = 'purple';
                // triangle_ctx.stroke();

                triangle_ctx.fill();
                //triangle_ctx.fillStyle = 'rgb(255,255,255)';
                //triangle_ctx.fillRect(triangles[i].a.x,triangles[i].a.y, 1, 1);
            }

            triangle_ctx.strokeStyle = 'black';

            triangle_ctx.scale(1, 1);

            stat.stop("rendering");

        }

        // log.innerHTML = stat.log();
    }
}







// D3 
// -------

var sc = 4;
var width = 1200,
    height = 800;
//var svg = d3.select("#wrapper").append("svg")
var svg = d3.selectAll([document.getElementById("#wrapper"), document.body]).append("svg")
    .attr("id", "meshsvg")
    .attr("width", width)
    .attr("height", height);
var d3_geom_voronoi = d3.geom.voronoi().x(function(d) { return d.x; }).y(function(d) { return d.y; })
var link = svg.selectAll("line");
var facerect = svg.selectAll("rect");

function update_d3(nodes) {

    link = link.data(d3_geom_voronoi.links(nodes));
    link.enter().append("line")
    link
        .attr("x1", function(d) { return 750 - (d.source.x * sc); })
        .attr("y1", function(d) { return 50 + (d.source.y * sc); })
        .attr("x2", function(d) { return 750 - (d.target.x * sc); })
        .attr("y2", function(d) { return 50 + (d.target.y * sc); });
    link.exit().remove();
}

function update_d3_face(facearray) {

    facerect = facerect.data(facearray);
    facerect.enter().append("rect")
    facerect.transition()
        .attr("x", function(d) { return d.x * sc; })
        .attr("y", function(d) { return d.y * sc; })
        .attr("width", function(d) { return d.w * sc; })
        .attr("height", function(d) { return d.h * sc; })
        .attr("rx", function(d) { return d.w/2 * sc; })
        .attr("ry", function(d) { return d.h/2 * sc; });
    facerect.exit().remove();

    // console.log(facerect);
}








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
    console.log(n);

    face_ctx.clearRect(0,0,face_canvas.width, face_canvas.height);


    for(var i = 0; i < n; ++i) {
        r = rects[i];
        ctx.strokeRect(
            (cwid - r.x*sc - r.width*sc)|0,
            (r.y*sc)|0,
            (r.width*sc)|0,
            (r.height*sc)|0
        );

        var faceData = canvas.getContext('2d').getImageData(r.x,r.y,r.width,r.height);   
        face_ctx.putImageData(faceData, i * 120, 0);
        // return range_to_one(r.width, [22,60]);
    }

    // update_d3_face([]);

}





var dither_worker = new Worker("dither.js");
var dither_worker_busy = false;

dither_worker.addEventListener('message', function (e) {
    dither_canvas.getContext('2d').putImageData(e.data, 0, 0);
    dither_worker_busy = false;
}, false);

function ditherize(input_canvas) {
  if (input_canvas && dither_worker && !dither_worker_busy) {
    // if (this.canvas.height !== this._image.height) {
    //   this.canvas.height = this._image.height;
    // }
    // if (this.canvas.width !== this._image.width) {
    //   this.canvas.width = this._image.width;
    // }
    var imageData = input_canvas.getContext('2d').getImageData(0,0, input_canvas.width, input_canvas.height);        
    // var data = dither(imageData, this._threshold, this._type);
    // this.context.putImageData(data, 0, 0);
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


