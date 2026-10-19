(function () {
  "use strict";

  // Tandai elemen yang akan muncul pelan-pelan saat discroll.
  var targets = document.querySelectorAll(
    ".section-head, .feat, .moves, .steps li, .shot, .levels li, .story-copy, .compare, .cta-card"
  );
  targets.forEach(function (el) { el.classList.add("reveal"); });

  var show = function (el) { el.classList.add("in"); };

  if (!("IntersectionObserver" in window)) {
    targets.forEach(show);
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      show(entry.target);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  targets.forEach(function (el) { io.observe(el); });
})();
